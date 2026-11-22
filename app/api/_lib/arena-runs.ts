import { randomInt } from "node:crypto";
import { join } from "node:path";
import { CALLS_PER_HOUR, createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS } from "@/lib/agent";
import { createSdkAttacker } from "@/lib/arena/attacker";
import { liveSessionMaker } from "@/lib/arena/live-session";
import { runOvernight, type OvernightSession } from "@/lib/arena/overnight";
import { hourlyUse, readUsageLog, waitForRoom } from "@/lib/arena/pace";
import { loadScenarioSuite, runFixedScenarioSuite } from "@/lib/arena/suite-files";
import { getApprover, hasRole } from "@/lib/auth/session";
import { SEED } from "@/lib/seed";
import { fail } from "./http";

// The Safety suite's long runs, started from the page (Role 2 stand-in, Trail #68): Role 3's
// fixed scenario suite and overnight attacker, on the live agent, through the same
// AgentDriver, control layer and speech guard as every call (lib/arena/live-session.ts).
// Pharmacist only. One run at a time. Every model turn waits for room under the shared
// 60-calls-an-hour cap (lib/arena/pace.ts), and a run won't start when the hour is full.
// Progress lives in memory here and is read with GET /api/arena/run.

export type ArenaKind = "suite" | "overnight";
export type ArenaRun = {
  kind: ArenaKind;
  state: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  /** Suite: attempts saved. Overnight: attack calls started. */
  done: number;
  total: number;
  caught: number;
  broken: number;
  message?: string;
  resultPath?: string;
};
export type ArenaStatus = { running: ArenaRun | null; last: Partial<Record<ArenaKind, ArenaRun>>; usage: { used: number; perHour: number } };

export const ATTEMPTS_PER_SCENARIO = 3;
export const OVERNIGHT_DEFAULT_CALLS = 10;
export const OVERNIGHT_MAX_CALLS = 60;

type Holder = { current: ArenaRun | null; last: Partial<Record<ArenaKind, ArenaRun>> };
const g = globalThis as typeof globalThis & { __aegisArenaRuns?: Holder };
const holder = (): Holder => (g.__aegisArenaRuns ??= { current: null, last: {} });

export const arenaRunning = (): boolean => holder().current !== null;

export function resetArenaRunsForTests(): void {
  g.__aegisArenaRuns = { current: null, last: {} };
}

const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");
const makeCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const now = () => new Date().toISOString();

async function usedThisHour(): Promise<number> {
  return hourlyUse(await readUsageLog()(), Date.now());
}

export async function arenaStatus(): Promise<ArenaStatus> {
  const h = holder();
  return { running: h.current, last: h.last, usage: { used: await usedThisHour(), perHour: CALLS_PER_HOUR } };
}

/** 401/403 unless a pharmacist is signed in. Reviewers can watch progress but not spend the plan. */
export async function refuseUnlessPharmacist(): Promise<Response | null> {
  const approver = await getApprover();
  if (!approver) return fail(401, "Sign in as a pharmacist to start a run");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can start a live run");
  return null;
}

/** 401 unless staff (a pharmacist or reviewer) is signed in. */
export async function refuseUnlessStaff(): Promise<Response | null> {
  return (await getApprover()) ? null : fail(401, "Sign in to see run progress");
}

/** Everything that stops a run starting: who's asking, the live agent, another run, the hourly cap. */
export async function refuseArenaStart(): Promise<Response | null> {
  const refused = await refuseUnlessPharmacist();
  if (refused) return refused;
  if (process.env.LIVE_AGENT !== "1") return fail(503, "The live agent is off on this server. Set LIVE_AGENT=1 to run on this machine's Claude plan.");
  const running = holder().current;
  if (running) return fail(409, `A ${running.kind === "suite" ? "scenario suite" : "overnight"} run is already going`);
  const used = await usedThisHour();
  if (used + SDK_MAX_TURNS > CALLS_PER_HOUR) {
    const res = fail(429, `The live cap is full: ${used} of ${CALLS_PER_HOUR} model calls used in the last hour. Try again later.`);
    res.headers.set("retry-after", "600");
    return res;
  }
  return null;
}

/** { only?: string[] } of known scenario ids, or a reason it's not acceptable. */
export async function parseSuiteBody(body: Record<string, unknown> | null): Promise<{ only?: string[] } | string> {
  if (!body || body.only === undefined) return {};
  const ids = (await loadScenarioSuite()).map((s) => s.id);
  if (!Array.isArray(body.only) || body.only.length === 0 || !body.only.every((id) => typeof id === "string" && ids.includes(id))) {
    return "only must be a list of scenario ids from the suite";
  }
  return { only: [...new Set(body.only as string[])] };
}

/** { calls } from 1 to 60 (default 10), or a reason it's not acceptable. */
export function parseNightBody(body: Record<string, unknown> | null): { calls: number } | string {
  if (!body || body.calls === undefined) return { calls: OVERNIGHT_DEFAULT_CALLS };
  const calls = body.calls;
  if (typeof calls !== "number" || !Number.isInteger(calls) || calls < 1 || calls > OVERNIGHT_MAX_CALLS) return `calls must be a whole number from 1 to ${OVERNIGHT_MAX_CALLS}`;
  return { calls };
}

/** Claims the one run slot before anything async, so a second POST sees it straight away. */
export function claimArenaRun(kind: ArenaKind, total: number): ArenaRun {
  const run: ArenaRun = { kind, state: "running", startedAt: now(), done: 0, total, caught: 0, broken: 0 };
  holder().current = run;
  return run;
}

function finish(run: ArenaRun, patch: Partial<ArenaRun>): void {
  const h = holder();
  const ended = { ...run, ...patch, finishedAt: now() };
  h.last = { ...h.last, [run.kind]: ended };
  if (h.current === run) h.current = null;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The model every live call uses, paced so each turn waits for room under the cap. */
function liveModel() {
  return createAgentSdkModel({ model: process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL });
}

/** Role 3's fixed scenario suite (task 3.5), as the live-suite command runs it. */
export async function runSuiteNow(run: ArenaRun, only?: string[]): Promise<void> {
  try {
    const model = liveModel();
    const { report, resultPath } = await runFixedScenarioSuite({
      seed: SEED,
      makeCode,
      makeSession: (seed, target, code) => liveSessionMaker({ model, code, beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }) })(seed, target),
      retries: 2,
      // One call at a time, so pacing before each line holds the hourly cap.
      concurrency: 1,
      resultsDirectory: join(resultsDir(), "arena", "scenarios"),
      saveAttempt: async () => {
        run.done += 1;
      },
      emit: (event) => {
        if (event.type === "score") {
          run.caught = event.caught;
          run.broken = event.broken;
        }
      },
      ...(only ? { only } : {}),
    });
    finish(run, { state: "done", caught: report.caught, broken: report.broken, resultPath });
  } catch (error) {
    finish(run, { state: "failed", message: reason(error) });
  }
}

/** Role 3's overnight attacker (task 3.7), as the overnight command runs it, for `calls` attack calls. */
export async function runOvernightNow(run: ArenaRun, calls: number): Promise<void> {
  try {
    const modelName = process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL;
    const model = liveModel();
    const makeSession: OvernightSession = (seed, target, code, onRecord) => {
      run.done += 1;
      return liveSessionMaker({ model, code, onRecord, beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }) })(seed, target);
    };
    const report = await runOvernight({
      attacker: createSdkAttacker({ model: modelName, beforeCall: () => waitForRoom({ need: 1 + SDK_MAX_TURNS }) }),
      makeSession,
      maxCalls: calls,
      dir: join(resultsDir(), "arena", "overnight"),
      runId: new Date().toISOString().replace(/[:.]/g, "-"),
      model: modelName,
    });
    finish(run, {
      state: "done",
      done: report.calls,
      caught: report.caught,
      broken: report.broken,
      ...(report.stoppedBecause ? { message: report.stoppedBecause } : {}),
    });
  } catch (error) {
    finish(run, { state: "failed", message: reason(error) });
  }
}
