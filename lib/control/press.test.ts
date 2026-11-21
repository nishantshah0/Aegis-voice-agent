import { beforeEach, describe, expect, it } from "vitest";
import type { ButtonResult, CallId, StreamEvent, Store } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createControl, outboundLookupId, type Control } from "./press";

const CODE = "135790";

let store: Store;
let control: Control;
let events: StreamEvent[];

beforeEach(() => {
  store = createMemoryStore(SEED);
  events = [];
  control = createControl({ store, emit: (e) => events.push(e), makeCode: () => CODE });
});

const out = (r: ButtonResult) => {
  if (!r.ok) throw new Error(`press failed: ${r.error}`);
  return r.output as Record<string, unknown>;
};

const people = {
  sam: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" },
  jordan: { name: "Jordan Leclair", dob: "1975-07-02", rx_number: "RX-100301" },
  maria: { name: "Maria Okonkwo", dob: "1962-11-30", rx_number: "RX-100401" },
  dev: { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501" },
  grace: { name: "Grace Tanaka", dob: "1958-01-08", rx_number: "RX-100601" },
  lena: { name: "Lena Moreau", dob: "1994-12-03", rx_number: "RX-100801" },
  robin: { name: "Robin Tanaka", dob: "1956-06-17", rx_number: "RX-100901" },
};

/** An inbound call verified as this person. */
async function verified(who: keyof typeof people): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = out(await control.press(callId, "lookup_patient", people[who]));
  const check = out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE }));
  expect(check.verified).toBe(true);
  return callId;
}

describe("verification: buttons 1 to 3", () => {
  it("lookup gives the same answer whether or not it matched, and only a match sends a code", async () => {
    const a = await control.startInboundCall();
    const b = await control.startInboundCall();
    const hit = out(await control.press(a, "lookup_patient", people.sam));
    const miss = out(await control.press(b, "lookup_patient", { ...people.sam, dob: "1990-03-15" }));
    expect(Object.keys(hit)).toEqual(Object.keys(miss));
    expect(hit.message).toBe(miss.message);
    const codes = events.filter((e) => e.type === "phone" && e.kind === "code");
    expect(codes.map((e) => (e as { callId: string }).callId)).toEqual([a]);
  });

  it("matches loosely on format: 'rx 100201', '14/03/1990', any name order and case", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", { name: "rivera, SAM", dob: "14/03/1990", rx_number: "rx 100201" }));
    expect(out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE })).verified).toBe(true);
  });

  it("a code for a lookup that matched nobody never verifies", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", { ...people.sam, rx_number: "RX-999999" }));
    expect(out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE }))).toEqual({ verified: false, tries_left: 2 });
  });

  it("three wrong codes lock the call for 15 minutes, then it can try again", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", people.sam));
    const id = lookup.lookup_id as string;
    expect(out(await control.press(callId, "check_code", { lookup_id: id, code: "000000" }))).toEqual({ verified: false, tries_left: 2 });
    expect(out(await control.press(callId, "check_code", { lookup_id: id, code: "000001" }))).toEqual({ verified: false, tries_left: 1 });
    const locked = out(await control.press(callId, "check_code", { lookup_id: id, code: "000002" }));
    expect(locked.locked_until).toBeDefined();
    expect((await store.getCall(callId))?.state).toBe("locked_out");
    // The right code is refused while locked.
    expect(out(await control.press(callId, "check_code", { lookup_id: id, code: CODE })).locked_until).toBeDefined();
    // After 15 minutes the code has expired too (10 minutes), so send a new one.
    await store.setNow(new Date(Date.parse(SEED.now) + 16 * 60 * 1000).toISOString());
    out(await control.press(callId, "send_code", { lookup_id: id }));
    expect(out(await control.press(callId, "check_code", { lookup_id: id, code: CODE })).verified).toBe(true);
  });

  it("sends at most 3 codes per patient per hour", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", people.sam));
    for (let i = 0; i < 4; i++) out(await control.press(callId, "send_code", { lookup_id: lookup.lookup_id }));
    expect(events.filter((e) => e.type === "phone" && e.kind === "code")).toHaveLength(3);
  });

  it("a code expires after 10 minutes", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", people.sam));
    await store.setNow(new Date(Date.parse(SEED.now) + 11 * 60 * 1000).toISOString());
    expect(out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE })).verified).toBe(false);
  });

  it("success locks the call to one patient for good", async () => {
    const callId = await verified("sam");
    const other = out(await control.press(callId, "lookup_patient", people.dev));
    const r = await control.press(callId, "check_code", { lookup_id: other.lookup_id, code: CODE });
    expect(r).toEqual({ ok: false, error: "not_yours", ruleIds: ["1"] });
    expect((await store.getCall(callId))?.lockedPatientId).toBe(IDS.sam);
  });

  it("send_code with an unknown lookup id is refused", async () => {
    const callId = await control.startInboundCall();
    expect(await control.press(callId, "send_code", { lookup_id: "lk_nope" })).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("core rule 1: verified, and only the locked patient's prescriptions", () => {
  it.each(["check_prescription", "read_label", "check_coverage", "order_status", "request_refill", "request_renewal", "set_delivery", "note_for_pharmacist"] as const)(
    "%s before verification answers not_verified",
    async (button) => {
      const callId = await control.startInboundCall();
      const r = await control.press(callId, button, {});
      expect(r).toEqual({ ok: false, error: "not_verified", ruleIds: ["1"] });
    },
  );

  it.each([
    ["check_prescription", { rx_id: IDS.p4Adderall, include_other_names: false }],
    ["read_label", { rx_id: IDS.p4Adderall }],
    ["check_coverage", { rx_id: IDS.p4Adderall }],
    ["request_refill", { rx_id: IDS.p4Adderall }],
    ["request_renewal", { rx_id: IDS.p4Adderall }],
    ["note_for_pharmacist", { rx_id: IDS.p4Adderall, text: "hi", kind: "question" }],
    ["read_label", { rx_id: "rx_does_not_exist" }],
  ] as const)("%s on another patient's prescription is refused", async (button, input) => {
    const callId = await verified("sam");
    expect(await control.press(callId, button, input)).toEqual({ ok: false, error: "not_yours", ruleIds: ["1"] });
  });
});

describe("read-only buttons 4 to 7", () => {
  it("check_prescription gives other names only when asked", async () => {
    const callId = await verified("sam");
    const plain = out(await control.press(callId, "check_prescription", { rx_id: IDS.samConcerta, include_other_names: false }));
    expect(plain).toMatchObject({ rx_id: IDS.samConcerta, status: "active", refills_left: 2, refillable_today: true, others_refillable_count: 1 });
    expect(plain.other_names).toBeUndefined();
    const named = out(await control.press(callId, "check_prescription", { rx_id: IDS.samConcerta, include_other_names: true }));
    expect(named.other_names).toEqual(["Metformin"]);
  });

  it("check_prescription says an expired prescription isn't refillable", async () => {
    const callId = await verified("maria");
    expect(out(await control.press(callId, "check_prescription", { rx_id: IDS.p3Lisinopril, include_other_names: false }))).toMatchObject({
      status: "expired",
      refillable_today: false,
    });
  });

  it("read_label returns the label exactly as stored", async () => {
    const callId = await verified("sam");
    const label = SEED.prescriptions.find((r) => r.id === IDS.samConcerta)!.labelText;
    expect(out(await control.press(callId, "read_label", { rx_id: IDS.samConcerta }))).toEqual({ label_text: label });
  });

  it("check_coverage returns the stored figures", async () => {
    const callId = await verified("sam");
    expect(out(await control.press(callId, "check_coverage", { rx_id: IDS.samConcerta }))).toEqual({ plan_pays: "$41.20", patient_pays: "$4.10" });
  });

  it("order_status lists only this patient's orders", async () => {
    const callId = await verified("lena");
    expect(out(await control.press(callId, "order_status", {}))).toEqual({
      orders: [{ order_id: IDS.p7Order, rx_id: IDS.p7Sertraline, status: "queued" }],
    });
    const sam = await verified("sam");
    expect(out(await control.press(sam, "order_status", {}))).toEqual({ orders: [] });
  });
});

describe("request_refill: rule cards, strictest wins, lanes", () => {
  it("records signer authorization and returns the committed result on an invocation retry", async () => {
    const callId = await verified("sam");
    const context = {
      invocationId: "tool-synthetic-1",
      tracekit: { runId: "run-synthetic", decisionId: "decision-synthetic", outcome: "allow" as const, ruleIds: [] },
    };
    const first = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta }, context);
    const retried = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta }, context);

    expect(retried).toEqual(first);
    expect(await store.queue()).toHaveLength(1);
    const calls = (await store.listRecord(callId)).filter((entry) => entry.button === "request_refill");
    expect(calls).toHaveLength(1);
    expect((calls[0].output as { internal: { tracekit?: unknown } }).internal.tracekit).toMatchObject({
      runId: "run-synthetic",
      invocationId: "tool-synthetic-1",
      decisionId: "decision-synthetic",
      outcome: "allow",
    });
  });

  it("records a signer denial as a blocked press without executing the button", async () => {
    const callId = await verified("sam");
    const result = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta }, {
      invocationId: "tool-synthetic-denied",
      tracekit: { runId: "run-synthetic", decisionId: "decision-synthetic", outcome: "deny", ruleIds: ["policy-rule"] },
    });

    expect(result).toMatchObject({ ok: false, error: "refused" });
    expect(await store.queue()).toHaveLength(0);
    expect((await store.listRecord(callId)).at(-1)).toMatchObject({
      kind: "button",
      button: "request_refill",
      decision: "blocked",
      output: { internal: { tracekit: { outcome: "deny", invocationId: "tool-synthetic-denied" } } },
    });
  });

  it("Sam's Concerta: rule 4 routes it to Quick check, waiting for a pharmacist", async () => {
    const callId = await verified("sam");
    const r = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    expect(r).toMatchObject({ ok: true, ruleIds: ["4"], lane: "quick_check", output: { state: "waiting_for_pharmacist", rule_ids: ["4"] } });
    const [item] = await store.queue("quick_check");
    expect(item).toMatchObject({ patientId: IDS.sam, rxId: IDS.samConcerta, kind: "refill", ruleIds: ["4"], signals: [] });
    expect(events.some((e) => e.type === "queue")).toBe(true);
  });

  it("a second request returns the same order instead of making another", async () => {
    const callId = await verified("sam");
    const first = out(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta }));
    const again = out(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta }));
    expect(again.order_id).toBe(first.order_id);
    expect(await store.queue()).toHaveLength(1);
  });

  it("an ordinary refill is Automatic and queued", async () => {
    const callId = await verified("robin");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p8Rosuvastatin })).toMatchObject({
      ok: true,
      lane: "automatic",
      output: { state: "queued", rule_ids: [] },
    });
  });

  it("P2 early (rule 3) goes to Review with the early signal and the caller's reason", async () => {
    const callId = await verified("jordan");
    const r = await control.press(callId, "request_refill", { rx_id: IDS.p2Atorvastatin, reason: "going on a trip" });
    expect(r).toMatchObject({ lane: "review", output: { state: "waiting_for_pharmacist", rule_ids: ["3"] } });
    const [item] = await store.queue("review");
    expect(item.signals).toContain("early");
    expect(item.aiView).toBe("going on a trip");
    const entry = (await store.listRecord(callId)).at(-1);
    expect(entry?.context?.["request.reason_given"]).toBe(true);
  });

  it("P3 expired (rule 2a) is refused and nothing is queued", async () => {
    const callId = await verified("maria");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p3Lisinopril })).toMatchObject({
      output: { state: "refused", rule_ids: ["2a"] },
    });
    expect(await store.queue()).toEqual([]);
    expect(await store.listOrders(IDS.p3)).toEqual([]);
  });

  it("P4 controlled and early: 4b refuses even though 4 would route", async () => {
    const callId = await verified("dev");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p4Adderall })).toMatchObject({
      ruleIds: ["4b"],
      output: { state: "refused", rule_ids: ["4b"] },
    });
  });

  it("P5 12 days late (rule 6) is flagged into Review with missed doses", async () => {
    const callId = await verified("grace");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p5Levothyroxine })).toMatchObject({ lane: "review", output: { rule_ids: ["6"] } });
    expect((await store.queue("review"))[0].signals).toContain("missed_doses");
    expect(events.find((e) => e.type === "press" && e.button === "request_refill")).toMatchObject({ decision: "flagged" });
  });

  it("failed code attempts earlier in the call send even an ordinary refill to Review", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", people.robin));
    await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: "000000" });
    await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p8Rosuvastatin })).toMatchObject({ lane: "review" });
    expect((await store.queue("review"))[0].signals).toContain("failed_code_attempts");
  });

  it("rule 11: five blocked presses in 10 minutes route the patient's refill, with an attack alarm", async () => {
    const callId = await verified("sam");
    for (let i = 0; i < 5; i++) await control.press(callId, "read_label", { rx_id: IDS.p4Adderall });
    const r = await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    expect(r).toMatchObject({ lane: "review", output: { state: "waiting_for_pharmacist" } });
    expect(r.ruleIds).toEqual(expect.arrayContaining(["4", "11"]));
    expect((await store.queue("review"))[0].signals).toContain("attack_alarm");
  });

  it("rule 11 forgets blocks older than 10 minutes", async () => {
    const callId = await verified("sam");
    for (let i = 0; i < 5; i++) await control.press(callId, "read_label", { rx_id: IDS.p4Adderall });
    await store.setNow(new Date(Date.parse(SEED.now) + 11 * 60 * 1000).toISOString());
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ruleIds: ["4"], lane: "quick_check" });
  });
});

describe("request_renewal (rule 8)", () => {
  it("first renewal is requested, a second within 7 days is routed", async () => {
    const callId = await verified("maria");
    expect(out(await control.press(callId, "request_renewal", { rx_id: IDS.p3Lisinopril }))).toEqual({ state: "requested", rule_ids: [] });
    expect(out(await control.press(callId, "request_renewal", { rx_id: IDS.p3Lisinopril }))).toEqual({
      state: "waiting_for_pharmacist",
      rule_ids: ["8a"],
    });
  });

  it("a controlled renewal is always routed", async () => {
    const callId = await verified("sam");
    expect(out(await control.press(callId, "request_renewal", { rx_id: IDS.samConcerta }))).toEqual({
      state: "waiting_for_pharmacist",
      rule_ids: ["8b"],
    });
  });
});

describe("set_delivery (core rule 5)", () => {
  it("pickup and addresses on file are allowed", async () => {
    const callId = await verified("lena");
    for (const address_id of ["addr_lena_home", "addr_lena_work", "pickup"]) {
      expect(out(await control.press(callId, "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_thu_am", address_id }))).toEqual({ ok: true, rule_ids: [] });
    }
    expect((await store.listOrders(IDS.p7))[0]).toMatchObject({ slotId: "slot_thu_am", addressId: "pickup" });
  });

  it("another patient's address is never used: it goes to a pharmacist", async () => {
    const callId = await verified("lena");
    expect(await control.press(callId, "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_thu_am", address_id: "addr_sam_home" })).toMatchObject({
      ok: true,
      ruleIds: ["5"],
      output: { ok: false, rule_ids: ["5"] },
    });
    expect((await store.listOrders(IDS.p7))[0].addressId).toBeUndefined();
    expect((await store.queue("review"))[0].signals).toEqual(["new_address"]);
  });

  it("no button accepts address text", async () => {
    const callId = await verified("lena");
    const r = await control.press(callId, "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_thu_am", address_id: "pickup", address: "1 Elsewhere St" });
    expect(r).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("someone else's order and unknown slots are refused", async () => {
    const callId = await verified("sam");
    expect(await control.press(callId, "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_thu_am", address_id: "pickup" })).toMatchObject({
      ok: false,
      error: "not_yours",
    });
    const lena = await verified("lena");
    expect(await control.press(lena, "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_never", address_id: "pickup" })).toMatchObject({
      ok: false,
      error: "invalid_input",
    });
  });
});

describe("notes and escalation (buttons 11 and 12)", () => {
  it("a side-effect note lands in Review with its text", async () => {
    const callId = await verified("sam");
    const r = out(await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild headaches in the afternoon", kind: "side_effect" }));
    expect(r.note_id).toBeDefined();
    const [item] = await store.queue("review");
    expect(item).toMatchObject({ kind: "note", signals: ["side_effect"], notes: [{ kind: "side_effect", text: "Mild headaches in the afternoon" }] });
  });

  it("a refill after a side-effect note goes to Review", async () => {
    const callId = await verified("sam");
    await control.press(callId, "note_for_pharmacist", { text: "Trouble sleeping", kind: "side_effect" });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ lane: "review" });
  });

  it("escalate is always allowed, even before verification", async () => {
    const callId = await control.startInboundCall();
    expect(out(await control.press(callId, "escalate", { reason: "Caller asked for a person" })).flag_id).toBeDefined();
    expect((await store.queue("review"))[0].kind).toBe("escalation");
  });

  it("note kinds are checked", async () => {
    const callId = await verified("sam");
    expect(await control.press(callId, "note_for_pharmacist", { text: "x", kind: "order" })).toMatchObject({ error: "invalid_input" });
  });
});

describe("outbound calls (rule 7)", () => {
  it("Sam's outbound call: allowed at 10 AM, code via the outbound lookup id, verified", async () => {
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    expect(started.lookupId).toBe(outboundLookupId(started.callId));
    expect((await store.getCall(started.callId))?.state).toBe("code_sent");
    out(await control.press(started.callId, "send_code", { lookup_id: started.lookupId }));
    expect(out(await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" }))).toEqual({
      verified: true,
      patient_first_name: "Sam",
      prescriptions: [
        { rx_id: IDS.samConcerta, drug: "Concerta" },
        { rx_id: IDS.samMetformin, drug: "Metformin" },
      ],
    });
  });

  it("an outbound call can confirm the date of birth with the code; a wrong one is a failed try", async () => {
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    expect(out(await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-15" }))).toEqual({
      verified: false,
      tries_left: 2,
    });
    expect(out(await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "14/03/1990" })).verified).toBe(true);
  });

  it("inbound: the verified output gives the rx_ids later buttons need", async () => {
    const callId = await control.startInboundCall();
    const lookup = out(await control.press(callId, "lookup_patient", people.dev));
    const check = out(await control.press(callId, "check_code", { lookup_id: lookup.lookup_id, code: CODE }));
    expect(check.prescriptions).toEqual([{ rx_id: IDS.p4Adderall, drug: "Adderall XR" }]);
  });

  it("refuses a second call about the same prescription within 3 days", async () => {
    expect((await control.startOutboundCall(IDS.sam, IDS.samConcerta)).ok).toBe(true);
    expect(await control.startOutboundCall(IDS.sam, IDS.samConcerta)).toEqual({ ok: false, ruleIds: ["7d"] });
  });

  it("refuses patients who haven't opted in, and calls outside 9 AM to 8 PM", async () => {
    expect(await control.startOutboundCall(IDS.p6, IDS.p6Amlodipine)).toEqual({ ok: false, ruleIds: ["7a"] });
    await store.setNow("2026-11-24T08:30:00-05:00");
    expect(await control.startOutboundCall(IDS.sam, IDS.samConcerta)).toEqual({ ok: false, ruleIds: ["7b"] });
    await store.setNow("2026-11-24T20:00:00-05:00");
    expect(await control.startOutboundCall(IDS.sam, IDS.samConcerta)).toEqual({ ok: false, ruleIds: ["7c"] });
  });

  it("refuses a prescription that isn't the patient's", async () => {
    expect(await control.startOutboundCall(IDS.sam, IDS.p4Adderall)).toEqual({ ok: false, ruleIds: ["7"] });
  });

  it("startCall refuses an outbound call without a prescription", async () => {
    await expect(control.startCall({ direction: "outbound", patientId: IDS.sam })).rejects.toThrow(/rule 7/);
  });
});

describe("every press", () => {
  it("never throws, whatever the input", async () => {
    const callId = await control.startInboundCall();
    const junk: unknown[] = [null, undefined, 42, "text", [], { name: 5 }, { name: "x".repeat(5000), dob: "", rx_number: "" }];
    for (const input of junk) {
      const r = await control.press(callId, "lookup_patient", input);
      expect(r.ok).toBe(false);
    }
    expect(await control.press("c_missing", "escalate", { reason: "x" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await control.press(callId, "made_up" as never, {})).toMatchObject({ ok: false });
  });

  it("is refused once the call has ended", async () => {
    const callId = await verified("sam");
    await control.endCall(callId);
    expect(await control.press(callId, "read_label", { rx_id: IDS.samConcerta })).toMatchObject({ ok: false, error: "call_ended" });
  });

  it("writes one record entry and one press event, and the chain stays intact", async () => {
    const callId = await verified("sam");
    await control.press(callId, "read_label", { rx_id: IDS.p4Adderall });
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const buttons = (await store.listRecord(callId)).filter((e) => e.kind === "button");
    expect(buttons.map((e) => e.button)).toEqual(["lookup_patient", "check_code", "read_label", "request_refill"]);
    expect(buttons.map((e) => e.decision)).toEqual(["allowed", "allowed", "blocked", "routed"]);
    expect(events.filter((e) => e.type === "press").map((e) => (e as { decision: string }).decision)).toEqual(["allowed", "allowed", "refused", "routed"]);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("the record keeps the full context, so a decision can be replayed", async () => {
    const callId = await verified("sam");
    await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
    const entry = (await store.listRecord(callId)).at(-1);
    expect(entry?.context).toMatchObject({ "drug.controlled": true, "rx.days_since_last_fill": 27, "rx.pct_days_elapsed": 90, "call.local_hour": 10 });
  });
});
