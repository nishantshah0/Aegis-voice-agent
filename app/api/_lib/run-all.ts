import { parseAttackerModel, type AttackerModel } from "@/lib/arena/attacker-models";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import { getApprover, hasRole } from "@/lib/auth/session";
import { hijackRunning, runHijackNow } from "../arena/hijack/run";
import { arenaRunning, arenaStatus, claimArenaRun, runSuiteNow, type ArenaRun } from "./arena-runs";
import { fail } from "./http";
import { claimLiveCall, customAttack, customDir, liveCallRunning, runLiveCall } from "./live-calls";
import { readdir } from "node:fs/promises";

// "Run all attacks" for the Safety suite's Attack library (Trail #69, Role 2 stand-in). One
// run, in order: the hijack batch (a scripted, fully fooled AI; no model), then every attack
// scenario on the live agent (scripted callers), then each saved custom attack as a live call
// with an attacker model. Each step uses the existing runner, the same AgentDriver, control
// layer and guard, and the same pacing under the shared hourly cap. Without LIVE_AGENT=1 only
// the scripted batch runs, and the other steps say why they were skipped.

export type StepKey = "hijack" | "scenarios" | "custom";
export type Step = { key: StepKey; label: string; state: "waiting" | "running" | "done" | "skipped" | "failed"; done: number; total: number; caught: number; broken: number; message?: string };
export type RunAll = { state: "running" | "done" | "failed"; startedAt: string; finishedAt?: string; attackerModel: AttackerModel; steps: Step[] };

/** Scenario groups that aren't attacks: everyday callers, outbound calls, emergencies. */
export const NOT_ATTACK_GROUPS = new Set(["ordinary_patients", "outbound_calls", "emergencies"]);

type Holder = { current: RunAll | null; last: RunAll | null; suite: ArenaRun | null };
const g = globalThis as typeof globalThis & { __aegisRunAll?: Holder };
const holder = (): Holder => (g.__aegisRunAll ??= { current: null, last: null, suite: null });
export function resetRunAllForTests(): void {
  g.__aegisRunAll = { current: null, last: null, suite: null };
}

/** The run so far; while the scenario step is going, its numbers come from the suite run itself. */
export function runAllStatus(): { running: RunAll | null; last: RunAll | null } {
  const h = holder();
  const live = (run: RunAll | null) => {
    if (!run || !h.suite) return run;
    return { ...run, steps: run.steps.map((s) => (s.key === "scenarios" && s.state === "running" ? { ...s, done: h.suite!.done, caught: h.suite!.caught, broken: h.suite!.broken } : s)) };
  };
  return { running: live(h.current), last: h.last };
}

export async function refuseRunAll(body: Record<string, unknown> | null): Promise<Response | AttackerModel> {
  const approver = await getApprover();
  if (!approver) return fail(401, "Sign in as a pharmacist to run the attacks");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can run the attacks");
  const model = parseAttackerModel(body?.attacker ?? body?.model);
  if (!model) return fail(400, "attacker must be claude or gemini");
  if (holder().current || arenaRunning() || liveCallRunning() || hijackRunning()) return fail(409, "Something is already running. One run at a time.");
  return model;
}

export async function planRunAll(): Promise<{ scenarioIds: string[]; customIds: string[] }> {
  const scenarioIds = (await loadScenarioSuite()).filter((s) => !NOT_ATTACK_GROUPS.has(s.group)).map((s) => s.id);
  const customIds = (await readdir(customDir()).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  return { scenarioIds, customIds };
}

export function claimRunAll(plan: { scenarioIds: string[]; customIds: string[] }, attackerModel: AttackerModel): RunAll {
  const step = (key: StepKey, label: string, total: number): Step => ({ key, label, state: "waiting", done: 0, total, caught: 0, broken: 0 });
  const run: RunAll = {
    state: "running",
    startedAt: new Date().toISOString(),
    attackerModel,
    steps: [step("hijack", "Hijacked AI: the four attack cards", 4), step("scenarios", "Attack scenarios, 3 calls each", plan.scenarioIds.length * 3), step("custom", "Your attacks, as live calls", plan.customIds.length)],
  };
  holder().current = run;
  return run;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runAllNow(run: RunAll, plan: { scenarioIds: string[]; customIds: string[] }): Promise<void> {
  const [hijack, scenarios, custom] = run.steps as [Step, Step, Step];
  const live = process.env.LIVE_AGENT === "1";
  try {
    hijack.state = "running";
    try {
      const { runs } = await runHijackNow();
      hijack.done = runs.length;
      hijack.caught = runs.reduce((n, r) => n + r.score.caught, 0);
      hijack.broken = runs.reduce((n, r) => n + r.score.broken, 0);
      hijack.state = "done";
    } catch (e) {
      Object.assign(hijack, { state: "failed", message: reason(e) });
    }

    if (!live) {
      for (const s of [scenarios, custom]) Object.assign(s, { state: "skipped", message: "The live agent is off on this server (LIVE_AGENT=1 runs it on the Claude plan)." });
    } else {
      if (plan.scenarioIds.length) {
        scenarios.state = "running";
        const suite = claimArenaRun("suite", plan.scenarioIds.length * 3);
        holder().suite = suite;
        await runSuiteNow(suite, plan.scenarioIds);
        holder().suite = null;
        // The suite run's final state (done or failed, and why) is kept with the arena runs.
        const ended = (await arenaStatus()).last.suite ?? suite;
        Object.assign(scenarios, { done: ended.done, caught: ended.caught, broken: ended.broken, state: ended.state === "failed" ? "failed" : "done", ...(ended.message ? { message: ended.message } : {}) });
      } else Object.assign(scenarios, { state: "skipped", message: "No attack scenarios found." });

      if (plan.customIds.length) {
        custom.state = "running";
        for (const id of plan.customIds) {
          const attack = await customAttack(id);
          if (!attack) continue;
          const call = claimLiveCall(attack, { kind: "custom", id }, run.attackerModel);
          await runLiveCall(call);
          custom.done += 1;
          custom.caught += call.verdict?.caught ?? 0;
          custom.broken += call.verdict?.broken.length ?? 0;
        }
        custom.state = "done";
      } else Object.assign(custom, { state: "skipped", message: "No custom attacks saved yet." });
    }
    run.state = run.steps.some((s) => s.state === "failed") ? "failed" : "done";
  } catch (e) {
    run.state = "failed";
    for (const s of run.steps) if (s.state === "running" || s.state === "waiting") Object.assign(s, { state: "failed", message: reason(e) });
  } finally {
    run.finishedAt = new Date().toISOString();
    const h = holder();
    h.suite = null;
    h.last = run;
    if (h.current === run) h.current = null;
  }
}
