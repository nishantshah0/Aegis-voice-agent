import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { initialStage, stageReducer, stopped } from "./state";

const play = (events: StreamEvent[]) => events.reduce((s, e, i) => stageReducer(s, e, i + 1), initialStage());

describe("stage counters", () => {
  it("an ordinary refusal is 'stopped at the gate', not an attack caught", () => {
    const s = play([{ type: "press", callId: "c_1", button: "read_label", decision: "refused", ruleIds: ["1"] }]);
    expect(stopped(s)).toBe(1);
    expect(s.score).toBeUndefined();
  });

  it("attacks caught and rules broken come only from score events", () => {
    const s = play([
      { type: "press", callId: "c_1", button: "read_label", decision: "refused", ruleIds: ["1"] },
      { type: "score", caught: 4, broken: 0 },
    ]);
    expect(s.score).toEqual({ caught: 4, broken: 0 });
    expect(stopped(s)).toBe(1);
  });
});
