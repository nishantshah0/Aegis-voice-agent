import { describe, expect, it } from "vitest";
import type { QueueItem, StreamEvent } from "./types";
import { forAudience } from "./audience";

const item: QueueItem = {
  id: "q_1", callId: "c_1", patientId: "p_sam", rxId: "rx_sam_concerta", kind: "refill", lane: "review", ruleIds: ["4"],
  signals: ["side_effect"], notes: [{ id: "n_1", kind: "side_effect", text: "Sleeping badly" }], aiView: "Routine",
  status: "open", createdAt: "2026-11-24T10:00:00-05:00",
};
const line: StreamEvent = { type: "line", callId: "c_1", who: "caller", text: "I'm Sam Rivera, born 1990-03-14" };
const blocked: StreamEvent = { type: "blocked_line", callId: "c_1", rule: "S1", original: "Your Concerta is due Friday, Sam Rivera.", replacement: "I can help with that once you're verified." };
const code: StreamEvent = { type: "phone", callId: "c_1", kind: "code", text: "Your pharmacy verification code is 123456." };
const ring: StreamEvent = { type: "phone", callId: "c_1", kind: "ring", text: "Maple Street Pharmacy is calling" };
const press: StreamEvent = { type: "press", callId: "c_1", button: "request_refill", decision: "routed", ruleIds: ["4"], lane: "review" };
const queue: StreamEvent = { type: "queue", item };
const score: StreamEvent = { type: "score", caught: 3, broken: 0 };
const otherLine: StreamEvent = { ...line, callId: "c_2" } as StreamEvent;

describe("forAudience", () => {
  it("never lets a code's digits out, to anyone", () => {
    for (const audience of [{ kind: "staff" }, { kind: "phone", callId: "c_1" }, { kind: "public" }] as const) {
      expect(JSON.stringify(forAudience(code, audience))).not.toMatch(/\d{6}/);
    }
  });

  it("gives signed-in staff everything else unchanged", () => {
    for (const e of [line, blocked, ring, press, queue, score]) expect(forAudience(e, { kind: "staff" })).toEqual(e);
  });

  it("gives a call's phone only its own call, with blocked originals withheld", () => {
    const phone = { kind: "phone", callId: "c_1" } as const;
    expect(forAudience(line, phone)).toEqual(line);
    expect(forAudience(otherLine, phone)).toBeNull();
    expect(forAudience(blocked, phone)).toEqual({ ...blocked, original: "" });
    expect(forAudience(ring, phone)).toEqual(ring);
    expect(forAudience(queue, phone)).toBeNull();
    expect(forAudience(press, phone)).toBeNull();
  });

  it("gives the public counters, presses, rings and redacted queue items, but no lines or blocked originals", () => {
    const pub = { kind: "public" } as const;
    expect(forAudience(line, pub)).toBeNull();
    expect(forAudience(blocked, pub)).toEqual({ ...blocked, original: "" });
    expect(forAudience(press, pub)).toEqual(press);
    expect(forAudience(score, pub)).toEqual(score);
    // The public ring carries no call id (Trail #19): only the paired device can answer.
    expect(forAudience(ring, pub)).toEqual({ ...ring, callId: "" });
    const redacted = forAudience(queue, pub) as Extract<StreamEvent, { type: "queue" }>;
    expect(redacted.item).toMatchObject({ id: "q_1", lane: "review", status: "open", kind: "refill" });
    expect(JSON.stringify(redacted)).not.toMatch(/Sleeping badly|p_sam|rx_sam|Routine/);
  });
});

describe("hijack cards on the public stream (4.6 stage)", () => {
  const hijack = (rule: string, callId = "hijack_b1_c3") =>
    ({ type: "blocked_line", callId, rule, original: "Take 90 tablets.", replacement: "Please check your label." }) as StreamEvent;

  it("keeps the original of an S3 or S4 line on a hijack_ card", () => {
    for (const rule of ["S3", "S4"]) expect(forAudience(hijack(rule), { kind: "public" })).toEqual(hijack(rule));
  });

  it("still blanks S1 and S2 originals on a hijack_ card", () => {
    for (const rule of ["S1", "S2"]) expect(forAudience(hijack(rule), { kind: "public" })).toMatchObject({ original: "" });
  });

  it("still blanks S3 and S4 originals on a real call", () => {
    for (const rule of ["S3", "S4"]) expect(forAudience(hijack(rule, "c_0001"), { kind: "public" })).toMatchObject({ original: "" });
  });

  it("doesn't give another call's phone the hijack original", () => {
    expect(forAudience(hijack("S3"), { kind: "phone", callId: "c_0001" })).toBeNull();
  });
});
