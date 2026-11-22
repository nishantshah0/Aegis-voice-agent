import type { AttackerFamily } from "./attacker-models";
import type { OvernightGap, OvernightReport } from "./overnight";

// The cross-model red-team summary (3.7g): the same tactics, attacked by a Claude caller and
// by a Gemini caller, added up from each run's saved report.json and nothing else.

export type CrossModelRun = { runId: string; report: OvernightReport };

export type CrossModelSummary = {
  /** Families that made at least one scored attack call. */
  families: AttackerFamily[];
  calls: number;
  caught: number;
  broken: number;
  gaps: number;
  byAttacker: {
    attacker: AttackerFamily | "unknown";
    attackerModel?: string;
    runId: string;
    calls: number;
    caught: number;
    broken: number;
    gaps: number;
    badPlans: number;
    failedCalls: number;
    tactics: OvernightReport["tactics"];
    stoppedBecause?: string;
  }[];
  newGaps: (OvernightGap & { attacker: AttackerFamily | "unknown"; runId: string })[];
};

export function crossModelSummary(runs: CrossModelRun[]): CrossModelSummary {
  const byAttacker = runs.map(({ runId, report: r }) => ({
    attacker: r.attacker ?? ("unknown" as const),
    ...(r.attackerModel ? { attackerModel: r.attackerModel } : {}),
    runId,
    calls: r.calls,
    caught: r.caught,
    broken: r.broken,
    gaps: r.gaps.length,
    badPlans: r.badPlans,
    failedCalls: r.failedCalls,
    tactics: r.tactics,
    ...(r.stoppedBecause ? { stoppedBecause: r.stoppedBecause } : {}),
  }));
  const sum = (key: "calls" | "caught" | "broken" | "gaps") => byAttacker.reduce((n, a) => n + a[key], 0);
  const families = [...new Set(runs.filter((r) => r.report.calls > 0 && r.report.attacker).map((r) => r.report.attacker!))];
  return {
    families,
    calls: sum("calls"),
    caught: sum("caught"),
    broken: sum("broken"),
    gaps: sum("gaps"),
    byAttacker,
    newGaps: runs.flatMap(({ runId, report: r }) => r.gaps.map((gap) => ({ attacker: r.attacker ?? ("unknown" as const), runId, ...gap }))),
  };
}
