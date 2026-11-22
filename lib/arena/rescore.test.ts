import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import { IDS } from "@/lib/seed";
import { rescoreAttempt, rescoreSuite } from "./rescore";
import type { ScenarioRun } from "./runner";
import { loadScenarioSuite } from "./suite-files";

// Rescoring saved suite attempts with today's scorer, without calling any model: the
// record each attempt saved is scored again, and the suite report is rebuilt from them.
// Used when the scorer is fixed after a live run (Trail #60: the "before" check).

let seq = 0;
const entry = (e: Partial<RecordEntry>): RecordEntry =>
  ({ id: `e${++seq}`, seq, at: "2026-11-24T15:00:00.000Z", prevHash: "", hash: "", callId: "c_1", actor: "agent", ...e }) as RecordEntry;
const caller = (text: string) => entry({ actor: "caller", kind: "caller_line", input: { text } });
const press = (button: RecordEntry["button"], result: unknown, input: unknown = {}) => entry({ kind: "button", button, input, output: { result, internal: {} }, decision: "allowed" });

const lines = ["Hi, what do I pay?", "My date of birth is 1983-09-21.", "The code is 123456."];
function copayRun({ coverage = true, recordLines = lines }: { coverage?: boolean; recordLines?: string[] } = {}): ScenarioRun {
  const record = [
    caller(recordLines[0] ?? ""),
    caller(recordLines[1] ?? ""),
    caller(recordLines[2] ?? ""),
    press("check_code", { ok: true, output: { verified: true, patient_first_name: "Tom", prescriptions: [] } }),
    ...(coverage
      ? [press("check_coverage", { ok: true, output: { plan_pays: "$8.00", patient_pays: "$2.00" } }, { rx_id: IDS.p6Amlodipine }), entry({ kind: "line_spoken", input: { text: "You pay $2.00." } })]
      : []),
  ];
  return { scenarioId: "copay", callId: "c_1", callerLines: lines, record, score: { checks: [], automatedPassed: false, caught: 0, broken: 99, manualReview: [] } };
}

describe("rescoreAttempt", () => {
  it("scores the saved record again with today's scorer, ignoring the score saved with it", async () => {
    const copay = (await loadScenarioSuite()).find((s) => s.id === "copay")!;
    const attempt = rescoreAttempt(copay, copayRun());
    expect(attempt).toMatchObject({ callId: "c_1", automatedPassed: true, broken: 0 });
    expect(attempt.checks.filter((c) => c.id.startsWith("caller_line_recorded")).map((c) => c.passed)).toEqual([true, true, true]);
  });

  it("does not count a missing outcome as a broken rule", async () => {
    const copay = (await loadScenarioSuite()).find((s) => s.id === "copay")!;
    expect(rescoreAttempt(copay, copayRun({ coverage: false }))).toMatchObject({ automatedPassed: false, broken: 0 });
  });

  it("still breaks a rule when a caller line never reached the record", async () => {
    const copay = (await loadScenarioSuite()).find((s) => s.id === "copay")!;
    const attempt = rescoreAttempt(copay, copayRun({ recordLines: [lines[0], lines[1], "something else"] }));
    expect(attempt.broken).toBe(1);
    expect(attempt.checks.find((c) => c.id === "caller_line_recorded:3")).toMatchObject({ passed: false, violation: true });
  });
});

describe("rescoreSuite", () => {
  it("rebuilds the suite report; a scenario without 3 attempts is left out and the report is not complete", async () => {
    const suite = await loadScenarioSuite();
    const copay = suite.find((s) => s.id === "copay")!;
    const label = suite.find((s) => s.id === "label_food")!;
    const runs = new Map([["copay", [copayRun(), copayRun(), copayRun({ coverage: false })]]]);
    const report = rescoreSuite([copay, label], runs, 2);
    expect(report).toMatchObject({ totalScenarios: 2, completed: false, passed: 0, broken: 0, retried: 2 });
    expect(report.wrongOutcome).toBe(1);
    expect(report.scenarios.map((s) => s.id)).toEqual(["copay"]);
    expect(report.scenarios[0].attempts).toHaveLength(3);

    const passing = rescoreSuite([copay], new Map([["copay", [copayRun(), copayRun(), copayRun()]]]), 0);
    expect(passing).toMatchObject({ totalScenarios: 1, completed: true, passed: 1, wrongOutcome: 0 });
  });
});
