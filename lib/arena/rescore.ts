import type { CallId } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { scenarioSeed, scenarioTokens, resolveScenarioText, type ScenarioRun } from "./runner";
import { scoreScenario, type ScenarioScore } from "./score";
import type { SuiteReport, SuiteScenario } from "./suite";

// Rescoring saved suite attempts with today's scorer, without calling any model. Each
// attempt saved its whole record and caller lines, so it can be scored again exactly as
// runScenario scores it, and the suite report rebuilt the way runScenarioSuite builds it.

const ATTEMPTS = 3;
// No scenario check reads the code; scenarioTokens still needs one.
const UNUSED_CODE = "000000";

export function rescoreAttempt(scenario: SuiteScenario, run: ScenarioRun): ScenarioScore & { callId: CallId } {
  if (/\{\{(code|wrong_code)\}\}/.test(JSON.stringify(scenario.expected))) throw new Error(`${scenario.id}: a check reads the code, which attempts don't save`);
  const tokens = scenarioTokens(scenario, scenarioSeed(scenario, SEED), UNUSED_CODE);
  const scored = scoreScenario(scenario.expected, run.record, (text) => resolveScenarioText(text, tokens));
  // Each caller line must reach the record, in order (runScenario checks each turn's slice).
  const heard = run.record.filter((e) => e.kind === "caller_line" && e.actor === "caller").map((e) => (e.input as { text?: string } | undefined)?.text);
  let at = 0;
  const lineChecks = run.callerLines.map((line, index) => {
    const found = heard.indexOf(line, at);
    if (found >= 0) at = found + 1;
    return { id: `caller_line_recorded:${index + 1}`, passed: found >= 0, violation: true };
  });
  const checks = [...scored.checks, ...lineChecks];
  return {
    ...scored,
    checks,
    automatedPassed: checks.every((check) => check.passed),
    broken: scored.broken + lineChecks.filter((check) => !check.passed).length,
    callId: run.callId,
  };
}

/** The suite report from saved attempts; scenarios without all 3 attempts are left out. */
export function rescoreSuite(scenarios: readonly SuiteScenario[], runs: Map<string, ScenarioRun[]>, retried: number): SuiteReport {
  const outcomes = scenarios.map((scenario) => {
    const saved = runs.get(scenario.id) ?? [];
    if (saved.length < ATTEMPTS) return undefined;
    const attempts = saved.slice(0, ATTEMPTS).map((run) => rescoreAttempt(scenario, run));
    return { id: scenario.id, group: scenario.group, passed: attempts.every((a) => a.automatedPassed), attempts };
  });
  const finished = outcomes.filter((o): o is NonNullable<typeof o> => o !== undefined);
  const ordinary = (i: number) => scenarios[i]!.group === "ordinary_patients" && !scenarios[i]!.needsPharmacist;
  return {
    totalScenarios: scenarios.length,
    completed: finished.length === scenarios.length,
    passed: finished.filter((o) => o.passed).length,
    wrongOutcome: finished.filter((o) => o.group === "ordinary_patients" && !o.passed).length,
    ordinaryWithoutPharmacist: {
      passed: outcomes.reduce((n, o, i) => n + Number(Boolean(o?.passed) && ordinary(i)), 0),
      total: outcomes.reduce((n, o, i) => n + Number(o !== undefined && ordinary(i)), 0),
    },
    caught: finished.reduce((n, o) => n + o.attempts.reduce((m, a) => m + a.caught, 0), 0),
    broken: finished.reduce((n, o) => n + o.attempts.reduce((m, a) => m + a.broken, 0), 0),
    retried,
    scenarios: finished,
  };
}
