import { describe, expect, it } from "vitest";
import type { QueueItem, RecordEntry } from "@/lib/contract";
import { latestCallEvents } from "./replay";

let seq = 0;
const entry = (callId: string | undefined, e: Partial<RecordEntry>): RecordEntry =>
  ({ id: `r_${++seq}`, seq, at: "2026-11-24T10:00:00-05:00", hash: "h", prevHash: "p", actor: "agent", kind: "button", callId, ...e }) as RecordEntry;

const RECORD: RecordEntry[] = [
  entry("c_0001", { actor: "caller", kind: "caller_line", input: { text: "Old call" }, decision: "allowed" }),
  entry("c_0002", { actor: "caller", kind: "caller_line", input: { text: "Hi, it's Sam." }, decision: "allowed" }),
  entry("c_0002", { kind: "line_spoken", input: { text: "Thanks, Sam." }, decision: "allowed" }),
  entry("c_0002", { kind: "button", button: "request_refill", decision: "routed", ruleIds: ["4"], lane: "review", input: { rx_id: "rx" }, output: { ok: true } }),
  entry("c_0002", { kind: "button", button: "read_label", decision: "blocked", ruleIds: ["1"] }),
  entry("c_0002", { kind: "line_blocked", input: { text: "It's approved." }, output: { rule: "S4", replacement: "A pharmacist will check it first." }, decision: "blocked" }),
  entry(undefined, { actor: "system", kind: "rule_change" }),
];

const QUEUE = [
  { id: "q_1", callId: "c_0002", patientId: "p_sam", kind: "refill", lane: "review", ruleIds: ["4"], signals: [], notes: [], status: "open", createdAt: "t" },
  { id: "q_0", callId: "c_0001", patientId: "p_sam", kind: "refill", lane: "review", ruleIds: ["4"], signals: [], notes: [], status: "open", createdAt: "t" },
] as QueueItem[];

describe("latestCallEvents", () => {
  it("turns the newest call's record into the events the live stream sends, for staff", () => {
    const { callId, events } = latestCallEvents(RECORD, QUEUE, { kind: "staff" });
    expect(callId).toBe("c_0002");
    expect(events).toEqual([
      { type: "line", callId: "c_0002", who: "caller", text: "Hi, it's Sam." },
      { type: "line", callId: "c_0002", who: "agent", text: "Thanks, Sam." },
      { type: "press", callId: "c_0002", button: "request_refill", decision: "routed", ruleIds: ["4"], lane: "review" },
      { type: "press", callId: "c_0002", button: "read_label", decision: "refused", ruleIds: ["1"] },
      { type: "blocked_line", callId: "c_0002", rule: "S4", original: "It's approved.", replacement: "A pharmacist will check it first." },
      { type: "line", callId: "c_0002", who: "agent", text: "A pharmacist will check it first." },
      { type: "queue", item: QUEUE[0] },
    ]);
  });

  it("gives the public projector only what the public stream gives: no lines, no originals, a redacted queue", () => {
    const { events } = latestCallEvents(RECORD, QUEUE, { kind: "public" });
    expect(events.some((e) => e.type === "line")).toBe(false);
    expect(events.find((e) => e.type === "blocked_line")).toMatchObject({ original: "" });
    expect(events.find((e) => e.type === "queue")).toMatchObject({ item: { patientId: "", notes: [] } });
    expect(events.filter((e) => e.type === "press")).toHaveLength(2);
  });

  it("returns nothing when no call has happened", () => {
    expect(latestCallEvents([], [], { kind: "staff" })).toEqual({ callId: null, events: [] });
  });
});
