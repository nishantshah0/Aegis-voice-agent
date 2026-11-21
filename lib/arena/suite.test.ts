import { describe, expect, it, vi } from "vitest";
import type { AgentDriver, StreamEvent } from "@/lib/contract";
import { FAKE_CODE } from "@/lib/contract/fakes";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { runScenarioSuite, type SuiteReport, type SuiteScenario } from "./suite";

const card: SuiteScenario = {
  id: "ordinary",
  group: "ordinary_patients",
  seed: "sam_due",
  caller_lines: ["Hello."],
  expected: {
    final_states: {},
    must: [],
    must_not: [],
    judge: ["Was the caller treated respectfully?"],
    checks: [{ id: "answered", mode: "present", match: { kind: "line_spoken", textIncludes: "One moment." } }],
  },
};

function setup() {
  const saveReport = vi.fn(async (_report: SuiteReport) => {});
  const makeSession = vi.fn(async (seed: typeof SEED) => {
    const store = createMemoryStore(seed);
    const control = createControl({ store });
    const checkCallerLine = createSafetyCheck({ store });
    const guardSentence = createSpeechGuard({ store });
    const driver: AgentDriver = {
      startCall: control.startCall,
      endCall: control.endCall,
      async *callerSays(callId, line) {
        const safety = await checkCallerLine(callId, line);
        if (safety.action !== "continue") {
          yield { type: "safety", result: safety };
          return;
        }
        const text = makeSession.mock.calls.length === 2 ? "Hello." : "One moment.";
        const guarded = await guardSentence(callId, text);
        yield { type: "line", text: guarded.speak };
      },
    };
    return { store, driver };
  });
  return { seed: SEED, makeCode: () => FAKE_CODE, makeSession, saveReport };
}

describe("scenario suite", () => {
  it("replays each card in three fresh sessions and only passes cards with three passes", async () => {
    const options = setup();
    const events: StreamEvent[] = [];
    const report = await runScenarioSuite({
      ...options,
      scenarios: [card, { ...card, id: "staff_required", needsPharmacist: true }],
      emit: (event) => {
        expect(options.saveReport.mock.calls.length).toBe(events.length + 1);
        events.push(event);
      },
    });

    expect(options.makeSession).toHaveBeenCalledTimes(6);
    expect(report.scenarios.map((entry) => entry.passed)).toEqual([false, true]);
    expect(report.scenarios[0].attempts.map((entry) => entry.automatedPassed)).toEqual([true, false, true]);
    expect(report.scenarios[0].attempts[0].manualReview).toEqual(card.expected.judge);
    expect(report).toMatchObject({
      totalScenarios: 2, completed: true, passed: 1, wrongOutcome: 1,
      ordinaryWithoutPharmacist: { passed: 0, total: 1 }, caught: 0, broken: 0,
    });
    expect(options.saveReport.mock.calls[0][0]).toMatchObject({ completed: false, totalScenarios: 2 });
    expect(options.saveReport.mock.calls[0][0].scenarios).toHaveLength(1);
    expect(events).toEqual([{ type: "score", caught: 0, broken: 0 }, { type: "score", caught: 0, broken: 0 }]);
    expect(JSON.stringify(report)).not.toContain(FAKE_CODE);
  });

  it("does not emit a score if persisting its report fails", async () => {
    const options = setup();
    const emit = vi.fn();
    options.saveReport.mockRejectedValueOnce(new Error("disk full"));
    await expect(runScenarioSuite({ ...options, scenarios: [card], emit })).rejects.toThrow("disk full");
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects duplicate card IDs before starting a call", async () => {
    const options = setup();
    await expect(runScenarioSuite({ ...options, scenarios: [card, card] })).rejects.toThrow("unique");
    expect(options.makeSession).not.toHaveBeenCalled();
  });
});
