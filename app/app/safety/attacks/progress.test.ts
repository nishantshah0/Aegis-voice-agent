import { describe, expect, it } from "vitest";
import { HIJACK_CARDS } from "@/lib/arena/hijack-batch";
import type { StreamEvent } from "@/lib/contract";
import { BATCH_ORDER, batchDone, batchReducer, cardStatus, initialBatch } from "./progress";

const press = (callId: string, decision: "allowed" | "refused" | "routed" = "refused"): StreamEvent => ({
  type: "press",
  callId,
  button: "request_refill",
  decision,
  ruleIds: ["4b"],
});
const run = (events: StreamEvent[]) => events.reduce(batchReducer, initialBatch());

describe("hijack batch progress", () => {
  it("follows the batch's own card order", () => {
    expect([...BATCH_ORDER]).toEqual([...HIJACK_CARDS]);
  });

  it("counts a card's presses and lines and finishes it on its score event", () => {
    const s = run([
      press("hijack_3_early_refill"),
      { type: "blocked_line", callId: "hijack_3_early_refill", rule: "S3", original: "", replacement: "x" },
      press("hijack_3_early_refill", "allowed"),
      { type: "score", caught: 2, broken: 0 },
      press("hijack_3_cross_patient"),
    ]);
    expect(s.batch).toBe(3);
    expect(s.cards.early_refill).toEqual({ stopped: 1, routed: 0, allowed: 1, lines: 1 });
    expect(cardStatus(s, "early_refill")).toBe("done");
    expect(cardStatus(s, "cross_patient")).toBe("running");
    expect(cardStatus(s, "new_address")).toBe("waiting");
    expect(s.caught).toBe(2);
    expect(batchDone(s)).toBe(false);
  });

  it("ignores picks, live calls and score events before a batch", () => {
    const s = run([{ type: "score", caught: 9, broken: 0 }, press("hijack_pick_1_early_refill"), press("c_0001")]);
    expect(s).toEqual(initialBatch());
  });

  it("starts over when a newer batch begins, and stops counting scores after four", () => {
    const four: StreamEvent[] = BATCH_ORDER.flatMap((c, i) => [press(`hijack_1_${c}`), { type: "score", caught: i + 1, broken: 0 } as StreamEvent]);
    const done = run([...four, { type: "score", caught: 99, broken: 1 }]);
    expect(batchDone(done)).toBe(true);
    expect(done.caught).toBe(4);
    const again = [press("hijack_2_early_refill")].reduce(batchReducer, done);
    expect(again.batch).toBe(2);
    expect(again.finished).toBe(0);
  });
});
