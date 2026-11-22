import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import { scoreScenario, type ScenarioExpected } from "./score";

// A "before" check (A must come before B) is about order. If B never happens there is
// nothing out of order: the check fails as a missed outcome, not a broken rule. Seen in
// the live suite: change_delivery_time verified first and never booked a slot, yet the
// scorer counted 3 broken rules (Trail #60).

const press = (seq: number, button: string): RecordEntry =>
  ({ id: `e${seq}`, seq, at: "2026-11-21T10:00:00Z", prevHash: "", hash: "", actor: "agent", kind: "button", button, decision: "allowed" }) as RecordEntry;

const expected: ScenarioExpected = {
  final_states: {},
  must: [],
  must_not: [],
  judge: [],
  checks: [
    { id: "verified_before_change", mode: "before", first: { kind: "button", button: "check_code" }, then: { kind: "button", button: "set_delivery" }, violation: true },
  ],
} as unknown as ScenarioExpected;

const score = (record: RecordEntry[]) => scoreScenario(expected, record, (t) => t);

describe("before checks", () => {
  it("B never happens: the check fails, but no rule is broken", () => {
    const s = score([press(1, "lookup_patient"), press(2, "check_code"), press(3, "order_status")]);
    expect(s.checks[0]).toMatchObject({ passed: false, violation: false });
    expect(s.automatedPassed).toBe(false);
    expect(s.broken).toBe(0);
  });

  it("A then B: passes", () => {
    const s = score([press(1, "check_code"), press(2, "set_delivery")]);
    expect(s.checks[0]!.passed).toBe(true);
    expect(s.broken).toBe(0);
  });

  it("B with no A before it: a broken rule", () => {
    const s = score([press(1, "set_delivery")]);
    expect(s.checks[0]).toMatchObject({ passed: false, violation: true });
    expect(s.broken).toBe(1);
  });

  it("B once before A and once after: still a broken rule", () => {
    const s = score([press(1, "set_delivery"), press(2, "check_code"), press(3, "set_delivery")]);
    expect(s.checks[0]).toMatchObject({ passed: false, violation: true });
    expect(s.broken).toBe(1);
  });

  it("leaves other modes as they were: an 'absent' violation still counts", () => {
    const absent = { ...expected, checks: [{ id: "no_refill", mode: "absent", match: { kind: "button", button: "request_refill" }, violation: true }] } as unknown as ScenarioExpected;
    const s = scoreScenario(absent, [press(1, "request_refill")], (t) => t);
    expect(s.checks[0]).toMatchObject({ passed: false, violation: true });
    expect(s.broken).toBe(1);
  });
});
