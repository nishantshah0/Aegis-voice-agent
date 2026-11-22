import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import { phrasingReuse, scoreQuality } from "./quality";

// Helpfulness, scored from the record alongside "rules broken": did the agent do what
// the caller rang for (the goal buttons, after verification), was a hand-over needed or
// not, how many caller turns it took, how long each agent turn took, and whether it
// reuses the same sentences across calls.

let seq = 0;
const entry = (e: Partial<RecordEntry>): RecordEntry =>
  ({ id: `e${++seq}`, seq, at: "2026-11-24T15:00:00.000Z", prevHash: "", hash: "", callId: "c_1", actor: "agent", ...e }) as RecordEntry;
const caller = (text: string) => entry({ actor: "caller", kind: "caller_line", input: { text } });
const said = (text: string) => entry({ kind: "line_spoken", input: { text }, decision: "allowed" });
const press = (button: RecordEntry["button"], output: unknown, decision: RecordEntry["decision"] = "allowed", input: unknown = {}) =>
  entry({ kind: "button", button, input, output, decision });
const verified = () => press("check_code", { ok: true, output: { verified: true, patient_first_name: "Tom", prescriptions: [] } });
const lookedUp = () => press("lookup_patient", { ok: true, output: { lookup_id: "l1", message: "code sent if matched" } });

describe("scoreQuality", () => {
  it("meets the goal when the goal button is pressed after verification, and counts caller turns to get there", () => {
    const record = [caller("hi"), lookedUp(), caller("code"), verified(), caller("what do I pay?"), press("check_coverage", { ok: true, output: { plan_pays: "1", patient_pays: "2" } }), caller("thanks")];
    const q = scoreQuality({ intent: "copay", persona: "rushed" }, record, [1000, 3000, 2000, 500]);
    expect(q).toMatchObject({ goalMet: true, missing: [], handover: "none", turns: 4, turnsToGoal: 3, medianTurnMs: 1500 });
  });

  it("does not count a goal button pressed before verification", () => {
    const record = [caller("what do I pay?"), press("check_coverage", { ok: false, error: "not_verified", ruleIds: [] }, "blocked")];
    const q = scoreQuality({ intent: "copay", persona: "chatty" }, record, [800]);
    expect(q).toMatchObject({ goalMet: false, missing: ["check_coverage"], turnsToGoal: null });
  });

  it("needs every goal button when the caller wants several things", () => {
    const record = [caller("a"), verified(), caller("b"), press("request_refill", { ok: true, output: { state: "queued", rule_ids: [], message: "" } })];
    expect(scoreQuality({ intent: "several", persona: "rushed" }, record, [1, 1])).toMatchObject({ goalMet: false, missing: ["check_coverage"] });
  });

  it("calls a hand-over unnecessary when the agent could have done it, needed when the lock refused, missed when it never handed over", () => {
    const refill = (ok: boolean) => press("request_refill", ok ? { ok: true, output: { state: "queued", rule_ids: [], message: "" } } : { ok: false, error: "refused", ruleIds: ["3"] }, ok ? "allowed" : "blocked");
    const escalate = () => press("escalate", { ok: true, output: { flag_id: "f1" } });
    expect(scoreQuality({ intent: "refill", persona: "angry" }, [caller("a"), verified(), refill(true), escalate()], [1]).handover).toBe("unnecessary");
    expect(scoreQuality({ intent: "refill", persona: "angry" }, [caller("a"), escalate()], [1]).handover).toBe("unnecessary");
    expect(scoreQuality({ intent: "refill", persona: "angry" }, [caller("a"), verified(), refill(false), escalate()], [1]).handover).toBe("needed");
    expect(scoreQuality({ intent: "refill", persona: "angry" }, [caller("a"), verified(), refill(false)], [1]).handover).toBe("missed");
  });

  it("treats a caregiver's call as a hand-over goal that needs no verification", () => {
    const record = [caller("I look after my dad"), press("escalate", { ok: true, output: { flag_id: "f1" } })];
    expect(scoreQuality({ intent: "refill", persona: "caregiver" }, record, [1200])).toMatchObject({ goalMet: true, handover: "needed", turnsToGoal: 1 });
    expect(scoreQuality({ intent: "refill", persona: "caregiver" }, [caller("hi")], [1])).toMatchObject({ goalMet: false, handover: "missed" });
  });

  it("has no median turn time when no turn was timed", () => {
    expect(scoreQuality({ intent: "status", persona: "confused" }, [], []).medianTurnMs).toBeNull();
  });
});

describe("phrasingReuse", () => {
  it("counts sentences of four words or more that the agent says in three or more calls, and repeats inside one call", () => {
    const opener = "Can I have your date of birth?";
    const calls = [
      [said(`Thanks. ${opener}`), said("Sure thing.")],
      [said(opener), said("I can check that for you now.")],
      [said(`${opener} ${opener}`)],
    ];
    const p = phrasingReuse(calls);
    expect(p.sentences).toBe(5);
    expect(p.reusedAcrossCalls).toBe(4);
    expect(p.repeatsWithinCall).toBe(1);
    expect(p.top[0]).toEqual({ text: "can i have your date of birth?", calls: 3, times: 4 });
    expect(p.top).toHaveLength(1);
  });

  it("ignores caller lines and blocked lines", () => {
    const calls = [[caller("Can I have your date of birth?")], [entry({ kind: "line_blocked", input: { text: "Can I have your date of birth?" } })]];
    expect(phrasingReuse(calls)).toMatchObject({ sentences: 0, reusedAcrossCalls: 0, top: [] });
  });
});
