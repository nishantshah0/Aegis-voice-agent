import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import type { ScenarioCheck } from "@/lib/arena/score";
import { parseEntry } from "../data";
import { displayRecord, failuresForAttempt } from "./failure-evidence";

function event(seq: number, fields: Partial<RecordEntry>): RecordEntry {
  return { id: `entry-${seq}`, seq, callId: "fixture", kind: "line_spoken", actor: "agent",
    at: "", prevHash: "", hash: "", ...fields };
}
const record = [
  event(7, { kind: "caller_line", actor: "caller", input: { text: "The code is 123456." } }),
  event(9, { kind: "button", button: "check_code", input: { code: "123456" }, output: { result: { ok: true, output: { verified: true } } } }),
  event(12, { kind: "caller_line", actor: "caller", input: { text: "What is the status?" } }),
  event(13, { kind: "line_blocked", input: { text: "Unspoken protected original" }, output: { replacement: "I'll check.", why: "sensitive explanation" } }),
  event(17, { kind: "button", button: "order_status", decision: "allowed" }),
  event(18, { kind: "button", button: "order_status", decision: "allowed" }),
];
function evidence(check: ScenarioCheck) {
  return failuresForAttempt([{ id: check.id, passed: false }], { checks: [check], final_states: {} },
    record, displayRecord(record.map(parseEntry)), v => v)[0];
}

describe("saved scenario failure evidence", () => {
  it("locates directly observed violations on the saved caller turn and actual record sequence", () => {
    expect(evidence({ id: "no_status", mode: "absent", match: { button: "order_status" } })).toMatchObject({
      turn: 2, seq: 17, expected: expect.stringContaining("order status"), observed: expect.stringContaining("allowed"),
    });
    expect(evidence({ id: "at_most_once", mode: "count", turn: 2, count: 1, match: { button: "order_status" } })).toMatchObject({ turn: 2, seq: 18 });
    expect(evidence({ id: "refill_first", mode: "before", first: { button: "request_refill" }, then: { button: "order_status" } })).toMatchObject({ turn: 2, seq: 17 });
  });

  it("attributes missing events only to call end, and never infers a specific culprit", () => {
    const e = evidence({ id: "book_on_turn", mode: "present", turn: 2, match: { resultBookedSlot: "slot_a" } });
    expect(e.observed).toContain("call end");
    expect(e.expected).toContain("caller turn 2");
    expect(e.seq).toBeUndefined();
    const missingLine = evidence({ id: "expected_response", mode: "present", turn: 2, match: { kind: "line_spoken", textIncludes: "tomorrow" } });
    expect(missingLine.seq).toBeUndefined();
    expect(missingLine.related).toMatchObject({ turn: 2, seq: 13, observed: expect.stringContaining("I'll check.") });
    expect(evidence({ id: "not_reached", mode: "absent", turn: 8, match: { button: "order_status" } }).observed).toContain("turn 8 was missing");
    expect(evidence({ id: "old_check", mode: "present", match: { inputRxId: "{{old_rx_id}}" } }).observed).toContain("do not establish");
  });

  it("protects verification details and blocked originals throughout the browser projection", () => {
    const shown = displayRecord(record.map(parseEntry));
    const e = evidence({ id: "no_block", mode: "absent", match: { kind: "line_blocked", textIncludes: "Unspoken protected original" } });
    const rendered = JSON.stringify([shown, e]);
    expect(rendered).not.toMatch(/123456|Unspoken protected original|sensitive explanation/);
    expect(shown[0].text).toContain("omitted");
    expect(shown[1]).not.toHaveProperty("input");
    expect(e).toMatchObject({ seq: 13, turn: 2, observed: expect.stringContaining("I'll check.") });
  });
});
