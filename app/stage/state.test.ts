import { describe, expect, it } from "vitest";
import type { QueueItem, StreamEvent } from "@/lib/contract";
import { describePass, initialStage, latestHijack, MAX_PASSES, stageReducer, stopped } from "./state";

const play = (events: StreamEvent[]) => events.reduce((s, e, i) => stageReducer(s, e, i + 1), initialStage());

const item = (lane: QueueItem["lane"], status: QueueItem["status"] = "open"): QueueItem => ({
  id: `q_${lane}`,
  callId: "c_1",
  patientId: "p_sam",
  kind: "refill",
  lane,
  ruleIds: [],
  signals: [],
  notes: [],
  status,
  createdAt: "2026-11-24T10:00:00-05:00",
});

describe("stage state", () => {
  it("counts presses by decision and lines replaced by the guard", () => {
    const s = play([
      { type: "press", callId: "c_1", button: "lookup_patient", decision: "allowed", ruleIds: [] },
      { type: "press", callId: "c_1", button: "read_label", decision: "refused", ruleIds: ["1"] },
      { type: "press", callId: "c_1", button: "request_refill", decision: "routed", ruleIds: ["4"], lane: "quick_check" },
      { type: "blocked_line", callId: "c_1", rule: "S4", original: "It's approved.", replacement: "A pharmacist will check it first." },
    ]);
    expect(s.counts).toEqual({ allowed: 1, refused: 1, routed: 1, flagged: 0, blocked: 1 });
    expect(stopped(s)).toBe(2);
    expect(s.passes[0]).toMatchObject({ gate: "speech", label: "S4", original: "It's approved." });
    expect(s.passes).toHaveLength(4);
  });

  it("takes caught and broken only from score events", () => {
    const s = play([
      { type: "score", caught: 3, broken: 0 },
      { type: "score", caught: 7, broken: 0 },
    ]);
    expect(s.score).toEqual({ caught: 7, broken: 0 });
  });

  it("counts lanes from open queue items only", () => {
    const s = play([
      { type: "queue", item: item("review") },
      { type: "queue", item: item("quick_check") },
      { type: "queue", item: item("quick_check", "approved") },
    ]);
    expect(s.lanes).toEqual({ automatic: 0, quick_check: 1, review: 1 });
  });

  it("keeps the newest passes first and drops old ones", () => {
    const events: StreamEvent[] = Array.from({ length: MAX_PASSES + 5 }, (_, i) => ({
      type: "press",
      callId: `c_${i}`,
      button: "escalate",
      decision: "allowed",
      ruleIds: [],
    }));
    const s = play(events);
    expect(s.passes).toHaveLength(MAX_PASSES);
    expect(s.passes[0].callId).toBe(`c_${MAX_PASSES + 4}`);
  });

  it("follows the demo clock and ignores lines", () => {
    const s = play([
      { type: "clock", now: "2026-11-24T10:00:00-05:00" },
      { type: "line", callId: "c_1", who: "agent", text: "Hello" },
    ]);
    expect(s.now).toBe("2026-11-24T10:00:00-05:00");
    expect(s.passes).toEqual([]);
    expect(s.events).toBe(2);
  });

  it("describes passes in plain words", () => {
    expect(describePass({ id: 1, gate: "button", label: "request_refill", decision: "routed", ruleIds: ["4"], callId: "c" })).toBe(
      "request refill → To a pharmacist · rule 4",
    );
    expect(describePass({ id: 2, gate: "speech", label: "S1", decision: "blocked", ruleIds: ["S1"], callId: "c" })).toBe("Speech rule S1 replaced a line");
  });

  it("spotlights the newest hijack attempt and never a live call's press", () => {
    const s = play([
      { type: "press", callId: "hijack_pick_1_early_refill", button: "request_refill", decision: "refused", ruleIds: ["4b"] },
      { type: "press", callId: "c_0001", button: "lookup_patient", decision: "allowed", ruleIds: [] },
    ]);
    expect(latestHijack(s)).toMatchObject({ callId: "hijack_pick_1_early_refill", label: "request_refill" });
    expect(latestHijack(play([{ type: "press", callId: "c_0001", button: "read_label", decision: "refused", ruleIds: ["1"] }]))).toBeUndefined();
  });
});
