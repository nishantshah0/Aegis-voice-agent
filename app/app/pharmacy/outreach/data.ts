// The Outreach viewer's data, read only from a saved simulation run in results/sim/<run>/.
// Nothing here is typed in: no saved run means "no run yet" and the command that makes one.

import { getApprover } from "@/lib/auth/session";
import { listRuns, readRun, type ForecastRow, type LaneCounts, type SimCall, type SimRefill, type SimSummary } from "@/lib/sim";
import type { FillEvent, PastCall, PreferredCallTime, StoppedMed } from "@/lib/seed/population";

export const SIM_COMMAND = "SIM=1 npx vitest run scripts/sim.run.test.ts";

export type OutreachRow = ForecastRow & {
  preferredCallTime: PreferredCallTime;
  dob: string;
  history: FillEvent[];
  stopped: StoppedMed[];
  pastCalls: PastCall[];
  sideEffects: { at: string; text: string }[];
  /** This prescription's calls and refills inside the simulated window. */
  windowCalls: SimCall[];
  windowRefills: SimRefill[];
  /** Share of past refills skipped or stopped, 0 to 1. */
  skipRate: number;
};

export type OutreachDay = {
  date: string;
  callsByLane: LaneCounts;
  calls: number;
  earlyReach: number;
  reviewLoad: number;
  refills: number;
  runOuts: number;
  withoutMedication: number;
  /** Prescriptions called this day, for the calendar's day filter. */
  rxIds: string[];
};

export type RunChoice = Pick<SimSummary, "runId" | "ranAt" | "outcomeSeed" | "earlyReach" | "populationSize" | "populationSeed">;

export type OutreachData = { summary: SimSummary; runs: RunChoice[]; rows: OutreachRow[]; days: OutreachDay[] };

export type OutreachLoad = { state: "signed_out" } | { state: "none"; runs: RunChoice[]; command: string } | { state: "missing"; runId: string; runs: RunChoice[] } | { state: "ok"; data: OutreachData };

const choice = (s: SimSummary): RunChoice => ({ runId: s.runId, ranAt: s.ranAt, outcomeSeed: s.outcomeSeed, earlyReach: s.earlyReach, populationSize: s.populationSize, populationSeed: s.populationSeed });

/** The asked-for run, or the newest saved one. */
export async function loadOutreach(runId?: string): Promise<OutreachLoad> {
  const runs = (await listRuns()).map(choice);
  if (!runs.length) return { state: "none", runs, command: SIM_COMMAND };
  const id = runId ?? runs[0].runId;
  const run = await readRun(id);
  if (!run) return { state: "missing", runId: id, runs };

  const byPatient = new Map(run.population.patients.map((p) => [p.patient.id, p] as const));
  const calls = run.days.flatMap((d) => d.calls);
  const refills = run.days.flatMap((d) => d.refills);
  const rows: OutreachRow[] = run.forecast.map((f) => {
    const sp = byPatient.get(f.patientId)!;
    const history = sp.history[f.rxId] ?? [];
    return {
      ...f,
      preferredCallTime: sp.preferredCallTime,
      dob: sp.patient.dob,
      history,
      stopped: sp.stopped,
      pastCalls: sp.pastCalls.filter((c) => c.rxId === f.rxId),
      sideEffects: sp.sideEffects.filter((s) => s.rxId === f.rxId).map(({ at, text }) => ({ at, text })),
      windowCalls: calls.filter((c) => c.rxId === f.rxId),
      windowRefills: refills.filter((r) => r.rxId === f.rxId),
      skipRate: history.length ? history.filter((e) => e.status === "skipped" || e.status === "stopped").length / history.length : 0,
    };
  });
  const days: OutreachDay[] = run.days.map((d) => ({
    date: d.date,
    callsByLane: d.callsByLane,
    calls: d.calls.length,
    earlyReach: d.calls.filter((c) => c.source === "early_reach").length,
    reviewLoad: d.reviewLoad,
    refills: d.refills.length,
    runOuts: d.runOuts.length,
    withoutMedication: d.withoutMedication,
    rxIds: d.calls.map((c) => c.rxId),
  }));
  return { state: "ok", data: { summary: run.summary, runs, rows, days } };
}

/** The page's loader: checks the session first, so nothing is read for a signed-out request. */
export async function loadOutreachSignedIn(runId?: string): Promise<OutreachLoad> {
  if (!(await getApprover())) return { state: "signed_out" };
  return loadOutreach(runId);
}
