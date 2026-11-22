import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crossModelSummary } from "./cross-model";
import { runOvernight, type OvernightReport } from "./overnight";

// The cross-model red-team run (3.7g): the same tactics, attacked once by a Claude caller
// and once by a Gemini caller. Each run's report.json says which family attacked, and the
// summary is computed only from those saved reports.

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cross-model-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const neverCalled = async () => { throw new Error("no call expected"); };

describe("which attacker a run's report names", () => {
  it("writes attacker and attackerModel into report.json when given", async () => {
    await runOvernight({ attacker: neverCalled, makeSession: neverCalled, maxCalls: 0, dir, runId: "g", model: "claude-haiku-5-5", attackerModel: "gemini-2.5-flash" });
    const saved = JSON.parse(await readFile(join(dir, "g", "report.json"), "utf8"));
    expect(saved).toMatchObject({ model: "claude-haiku-5-5", attacker: "gemini", attackerModel: "gemini-2.5-flash", calls: 0 });
  });

  it("leaves both out when no attacker model is given, as before", async () => {
    const report = await runOvernight({ attacker: neverCalled, makeSession: neverCalled, maxCalls: 0, dir, runId: "c" });
    expect(report).not.toHaveProperty("attacker");
    expect(report).not.toHaveProperty("attackerModel");
  });
});

function report(over: Partial<OvernightReport>): OvernightReport {
  return { ranAt: "2026-11-22T04:00:00.000Z", updatedAt: "2026-11-22T05:00:00.000Z", calls: 0, caught: 0, broken: 0, gaps: [], tactics: [], failedCalls: 0, badPlans: 0, ...over };
}

describe("crossModelSummary", () => {
  it("adds up each family's calls, what the lock caught and what broke", () => {
    const summary = crossModelSummary([
      { runId: "run-claude", report: report({ attacker: "claude", attackerModel: "claude-haiku-5-5", calls: 10, caught: 14, tactics: [{ id: "a", goal: "A", calls: 10, caught: 14, gaps: 0 }] }) },
      { runId: "run-gemini", report: report({ attacker: "gemini", attackerModel: "gemini-2.5-flash", calls: 9, caught: 11, badPlans: 1, tactics: [{ id: "a", goal: "A", calls: 9, caught: 11, gaps: 0 }] }) },
    ]);
    expect(summary).toMatchObject({ families: ["claude", "gemini"], calls: 19, caught: 25, broken: 0, gaps: 0 });
    expect(summary.byAttacker).toEqual([
      expect.objectContaining({ attacker: "claude", attackerModel: "claude-haiku-5-5", runId: "run-claude", calls: 10, caught: 14, broken: 0, gaps: 0, badPlans: 0, failedCalls: 0 }),
      expect.objectContaining({ attacker: "gemini", attackerModel: "gemini-2.5-flash", runId: "run-gemini", calls: 9, caught: 11, broken: 0, gaps: 0, badPlans: 1, failedCalls: 0 }),
    ]);
  });

  it("names each gap with the family that found it", () => {
    const gap = { scenario: "overnight_003_false_approval", summary: "Broke: S3.", fix: { status: "no fix yet" } };
    const summary = crossModelSummary([{ runId: "g", report: report({ attacker: "gemini", attackerModel: "gemini-2.5-flash", calls: 3, broken: 1, gaps: [gap] }) }]);
    expect(summary).toMatchObject({ families: ["gemini"], broken: 1, gaps: 1 });
    expect(summary.newGaps).toEqual([{ attacker: "gemini", runId: "g", ...gap }]);
  });

  it("only counts a family that actually made a call", () => {
    const summary = crossModelSummary([
      { runId: "c", report: report({ attacker: "claude", calls: 4 }) },
      { runId: "g", report: report({ attacker: "gemini", calls: 0, failedCalls: 3 }) },
    ]);
    expect(summary.families).toEqual(["claude"]);
  });
});
