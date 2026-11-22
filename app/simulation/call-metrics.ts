import type { TestEvent } from "./live-events";
import { REPLACED_ACTION } from "./live-clips";
import type { SuiteCategory } from "./suite-cards";

// Hamming-style scoring for a Business test call. Pass/fail and the checks come from the
// server, which scores the hash-chained record; the times are measured in the browser as each
// streamed event arrives (`at`, ms since the page started listening to this call).

export type TimedEvent = TestEvent & { at: number };

export type CallMetrics = {
  /** null when the call didn't finish with a verdict. */
  passed: boolean | null;
  safe: boolean | null;
  taskCompleted: boolean | null;
  decidedBy: string;
  turns: number;
  medianLatencyMs: number | null;
  maxLatencyMs: number | null;
  firstWordMs: number | null;
  replacements: number;
  handovers: number;
  caught: number;
  broken: number;
};

const HANDOVER = /^Sent for review|escalate/i;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function metricsFor(events: TimedEvent[]): CallMetrics {
  const start = events.find((e) => e.type === "start")?.at ?? events[0]?.at ?? 0;
  const verdict = events.find((e): e is Extract<TimedEvent, { type: "verdict" }> => e.type === "verdict");
  const error = events.find((e): e is Extract<TimedEvent, { type: "error" }> => e.type === "error");
  const checks = events.filter((e): e is Extract<TimedEvent, { type: "check" }> => e.type === "check");
  const failed = checks.find((c) => !c.passed);
  const lines = events.filter((e): e is Extract<TimedEvent, { type: "line" }> => e.type === "line");
  const latencies: number[] = [];
  lines.forEach((line, i) => {
    if (line.speaker !== "caller") return;
    const next = lines.slice(i + 1).find((l) => l.speaker === "pharmacy" || l.speaker === "caller");
    if (next?.speaker === "pharmacy") latencies.push(next.at - line.at);
  });
  const firstWord = lines.find((l) => l.speaker === "pharmacy");
  const actions = events.filter((e): e is Extract<TimedEvent, { type: "action" }> => e.type === "action");
  return {
    passed: verdict ? verdict.passed : null,
    safe: verdict ? verdict.broken === 0 : null,
    taskCompleted: verdict ? verdict.passed : null,
    decidedBy: verdict ? (failed ? `Failed: ${failed.label}` : `All ${checks.length} checks passed`) : (error?.message ?? "Not finished"),
    turns: lines.filter((l) => l.speaker === "caller").length,
    medianLatencyMs: median(latencies),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    firstWordMs: firstWord ? firstWord.at - start : null,
    replacements: actions.filter((a) => a.label === REPLACED_ACTION).length,
    handovers: actions.filter((a) => HANDOVER.test(a.label)).length,
    caught: verdict?.caught ?? 0,
    broken: verdict?.broken ?? 0,
  };
}

export type RunSummary = {
  calls: number;
  scored: number;
  passed: number;
  passRate: number | null;
  avgLatencyMs: number | null;
  failuresByCategory: Partial<Record<SuiteCategory, number>>;
  at: string;
  /** Each scored test's pass (true) or fail (false), for comparing runs. */
  results: Record<string, boolean>;
};

export function summarizeRun(run: { id: string; category: SuiteCategory; metrics: CallMetrics }[]): RunSummary {
  const scored = run.filter((r) => r.metrics.passed !== null);
  const passed = scored.filter((r) => r.metrics.passed).length;
  const medians = scored.map((r) => r.metrics.medianLatencyMs).filter((m): m is number => m !== null);
  const failuresByCategory: Partial<Record<SuiteCategory, number>> = {};
  for (const r of scored) if (r.metrics.passed === false) failuresByCategory[r.category] = (failuresByCategory[r.category] ?? 0) + 1;
  return {
    calls: run.length,
    scored: scored.length,
    passed,
    passRate: scored.length ? passed / scored.length : null,
    avgLatencyMs: medians.length ? Math.round(medians.reduce((a, b) => a + b, 0) / medians.length) : null,
    failuresByCategory,
    at: new Date().toISOString(),
    results: Object.fromEntries(scored.map((r) => [r.id, r.metrics.passed === true])),
  };
}

export type RunDelta = { passRate: number | null; avgLatencyMs: number | null; changed: { id: string; was: boolean; now: boolean }[] };

export function compareRuns(now: RunSummary, before: RunSummary | null): RunDelta | null {
  if (!before) return null;
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    passRate: diff(now.passRate, before.passRate),
    avgLatencyMs: diff(now.avgLatencyMs, before.avgLatencyMs),
    changed: Object.entries(now.results)
      .filter(([id, result]) => id in before.results && before.results[id] !== result)
      .map(([id, result]) => ({ id, was: before.results[id]!, now: result })),
  };
}
