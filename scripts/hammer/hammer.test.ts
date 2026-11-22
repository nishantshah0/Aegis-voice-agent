// npm test runs a quick hammer. npm run hammer runs the gate's hammer (depth 3 and
// 10,000 random sequences) and saves the real counts to results/hammer-latest.json.
// npm run hammer:deep adds depth 4 (for the overnight run).

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STARTING_CARDS, type RuleCard } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { ALL_ACTIONS, CORE_ACTIONS, HAMMER_CODE } from "./actions";
import { makeChecker } from "./invariants";
import { exhaustive, random, summary, type HammerReport } from "./run";

const mode = process.env.npm_lifecycle_event ?? "test";
const full = mode === "hammer" || mode === "hammer:deep";
const depth = mode === "hammer:deep" ? 4 : full ? 3 : 2;
const randomCount = full ? 10_000 : 300;
const TIMEOUT = 60 * 60 * 1000;

const reports: HammerReport[] = [];

function expectNothingBroken(r: HammerReport) {
  reports.push(r);
  console.log(summary(r));
  if (r.broken > 0) console.log(JSON.stringify(r.failures.slice(0, 3), null, 2));
  expect(r.broken).toBe(0);
  expect(r.presses).toBeGreaterThan(0);
}

describe(`hammers (${mode})`, () => {
  it(`exhaustive: every sequence up to ${depth} actions`, { timeout: TIMEOUT }, async () => {
    expectNothingBroken(await exhaustive(CORE_ACTIONS, depth));
  });

  it(`random: ${randomCount} sequences of 5 to 30 actions`, { timeout: TIMEOUT }, async () => {
    expectNothingBroken(await random(ALL_ACTIONS, randomCount));
    if (full) {
      mkdirSync("results", { recursive: true });
      const out = { ranAt: new Date().toISOString(), mode, depth, reports };
      writeFileSync("results/hammer-latest.json", JSON.stringify(out, null, 2));
    }
  });
});

describe("the checker catches real breakage", () => {
  const checker = makeChecker(SEED, HAMMER_CODE);

  it("a delivery to an address not on file", async () => {
    const store = createMemoryStore(SEED);
    await store.saveOrder({ id: "o_bad", rxId: IDS.p7Sertraline, patientId: IDS.p7, state: "queued", addressId: "addr_sam_home", createdAt: SEED.now });
    expect((await checker.check(store, undefined)).map((b) => b.rule)).toContain("delivery to an address not on file");
  });

  it("a live card with an allow outcome", async () => {
    const loose = { ...STARTING_CARDS[0], then: "allow" } as unknown as RuleCard;
    const store = createMemoryStore({ ...SEED, cards: [loose] });
    expect((await checker.check(store, undefined)).map((b) => b.rule)).toContain("live card with an allow outcome");
  });

  it("an edited record", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ actor: "system", kind: "gate_run" });
    const real = await store.listRecord();
    const tampered = { ...store, listRecord: async () => real.map((e) => ({ ...e, actor: "pharmacist" as const })) };
    expect((await checker.check(tampered, undefined)).map((b) => b.rule)).toContain("record hash chain broken");
  });

  it("an outbound call with no rule 7 check", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_x", actor: "system", kind: "safety", input: { check: "call_start", direction: "outbound", rx_id: IDS.p6Amlodipine }, decision: "allowed" });
    expect((await checker.check(store, undefined)).map((b) => b.rule)).toContain("outbound call breaking rule 7");
  });

  it("another patient's data in an output", async () => {
    const store = createMemoryStore(SEED);
    await store.saveCall({ id: "c_y", direction: "inbound", state: "verified", lockedPatientId: IDS.sam, startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] });
    const entry = await store.appendRecord({
      callId: "c_y",
      actor: "agent",
      kind: "button",
      button: "read_label",
      output: { result: { ok: true, output: { label_text: "ADDERALL XR 20 MG" }, ruleIds: [] }, internal: {} },
    });
    expect((await checker.check(store, entry)).map((b) => b.rule)).toContain("another patient's data in a button output");
  });

  it("a refill the cards forbid", async () => {
    const store = createMemoryStore(SEED);
    await store.saveCall({ id: "c_z", direction: "inbound", state: "verified", lockedPatientId: IDS.p4, startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] });
    await store.saveOrder({ id: "o_z", rxId: IDS.p4Adderall, patientId: IDS.p4, state: "waiting_for_pharmacist", createdAt: SEED.now });
    const entry = await store.appendRecord({
      callId: "c_z",
      actor: "agent",
      kind: "button",
      button: "request_refill",
      context: { "drug.controlled": true, "rx.days_since_last_fill": 20, "rx.prescribed_interval_days": 30, "policy.controlled_early_window_days": 3 },
      output: { result: { ok: true, output: { state: "waiting_for_pharmacist", order_id: "o_z" }, ruleIds: [] }, internal: { queueItemId: "q_planted" } },
    });
    expect((await checker.check(store, entry)).map((b) => b.rule)).toContain("refill queued that a rule forbids");
  });

  it("verified with the wrong code", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_v", actor: "system", kind: "safety", input: { check: "call_start", direction: "inbound" }, decision: "allowed" });
    await store.appendRecord({ callId: "c_v", actor: "agent", kind: "button", button: "lookup_patient", input: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" }, output: { result: { ok: true, output: {}, ruleIds: [] }, internal: { lookupId: "lk_1", matched: true, patientId: IDS.sam } } });
    const entry = await store.appendRecord({ callId: "c_v", actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "lk_1", code: "999999" }, output: { result: { ok: true, output: { verified: true }, ruleIds: [] }, internal: { patientId: IDS.sam } } });
    expect((await checker.check(store, entry)).map((b) => b.rule)).toContain("verified without the right code for that patient");
  });

  it("verified as a patient the lookup didn't name", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_w", actor: "system", kind: "safety", input: { check: "call_start", direction: "inbound" }, decision: "allowed" });
    await store.appendRecord({ callId: "c_w", actor: "agent", kind: "button", button: "lookup_patient", input: { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501" }, output: { result: { ok: true, output: {}, ruleIds: [] }, internal: { lookupId: "lk_1", matched: true, patientId: IDS.p4 } } });
    const entry = await store.appendRecord({ callId: "c_w", actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "lk_1", code: HAMMER_CODE }, output: { result: { ok: true, output: { verified: true }, ruleIds: [] }, internal: { patientId: IDS.sam } } });
    expect((await checker.check(store, entry)).map((b) => b.rule)).toContain("verified without the right code for that patient");
  });

  it("a fourth code in an hour", async () => {
    const store = createMemoryStore(SEED);
    let last;
    for (let i = 0; i < 4; i++) {
      last = await store.appendRecord({ callId: "c_r", actor: "agent", kind: "button", button: "send_code", output: { result: { ok: true, output: {}, ruleIds: [] }, internal: { codeSent: true, patientId: IDS.sam } } });
    }
    expect((await checker.check(store, last)).map((b) => b.rule)).toContain("more than 3 codes for a patient in an hour");
  });

  it("a spoken line with another patient's data, and an approval promise that didn't happen", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_s", actor: "system", kind: "safety", input: { check: "call_start", direction: "inbound" }, decision: "allowed" });
    const leak = await store.appendRecord({ callId: "c_s", actor: "agent", kind: "line_spoken", input: { text: "Your Concerta is due." }, decision: "allowed" });
    expect((await checker.check(store, leak)).map((b) => b.rule)).toContain("spoken line leaks patient data");
    const promise = await store.appendRecord({ callId: "c_s", actor: "agent", kind: "line_spoken", input: { text: "Your refill is approved." }, decision: "allowed" });
    expect((await checker.check(store, promise)).map((b) => b.rule)).toContain("spoken line promises an approval that didn't happen");
  });

  // Code review finding 4: the spoken-line checks must catch findings 1 and 2 on their own,
  // without reusing the guard's isCompletionPromise or RUN_OUT.
  it.each(["Approved!", "Good news, you're approved.", "The pharmacist approved.", "Done, all approved."])(
    "a bare approval with no approval in the record: %s",
    async (text) => {
      const store = createMemoryStore(SEED);
      const line = await store.appendRecord({ callId: "c_a", actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
      expect((await checker.check(store, line)).map((b) => b.rule)).toContain("spoken line promises an approval that didn't happen");
    },
  );

  it.each(["Your delivery is due Friday.", "Your refill is due Friday.", "It runs out Friday, so we'll bring it Friday.", "It arrives Friday."])(
    "a delivery day nobody booked: %s",
    async (text) => {
      const store = createMemoryStore(SEED);
      const line = await store.appendRecord({ callId: "c_d", actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
      expect((await checker.check(store, line)).map((b) => b.rule)).toContain("spoken line promises a delivery day nobody booked");
    },
  );

  it("a run-out day is not a delivery promise", async () => {
    const store = createMemoryStore(SEED);
    const line = await store.appendRecord({ callId: "c_d", actor: "agent", kind: "line_spoken", input: { text: "Your supply runs out Friday." }, decision: "allowed" });
    expect((await checker.check(store, line)).map((b) => b.rule)).not.toContain("spoken line promises a delivery day nobody booked");
  });

  it.each([
    ["no dob", {}],
    ["a wrong dob", { dob: "1990-03-15" }],
  ])("an outbound call verified with %s", async (_label, dob) => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_o", actor: "system", kind: "safety", input: { check: "call_start", direction: "outbound", rx_id: IDS.samConcerta }, decision: "allowed" });
    const entry = await store.appendRecord({ callId: "c_o", actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "out_c_o", code: HAMMER_CODE, ...dob }, output: { result: { ok: true, output: { verified: true }, ruleIds: [] }, internal: { patientId: IDS.sam } } });
    expect((await checker.check(store, entry)).map((b) => b.rule)).toContain("outbound call verified without the patient's date of birth");
  });

  it("an outbound call verified with the code and the right dob is fine", async () => {
    const store = createMemoryStore(SEED);
    await store.appendRecord({ callId: "c_o", actor: "system", kind: "safety", input: { check: "call_start", direction: "outbound", rx_id: IDS.samConcerta }, decision: "allowed" });
    const entry = await store.appendRecord({ callId: "c_o", actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "out_c_o", code: HAMMER_CODE, dob: "1990-03-14" }, output: { result: { ok: true, output: { verified: true }, ruleIds: [] }, internal: { patientId: IDS.sam } } });
    expect((await checker.check(store, entry)).map((b) => b.rule)).not.toContain("outbound call verified without the patient's date of birth");
  });

  it("the alphabet says the reviewed sentences and checks an outbound code with a dob", () => {
    const labels = CORE_ACTIONS.map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(["say bare approved", "say delivery due", "check right code with dob"]));
    expect(ALL_ACTIONS.map((a) => a.label)).toEqual(expect.arrayContaining(["say pharmacist approved", "say run out and bring", "check right code wrong dob"]));
  });

  // Trail #85: days supply and appointments. Each break is planted straight into the store.
  async function verifiedSam(store: ReturnType<typeof createMemoryStore>, callId: string) {
    await store.appendRecord({ callId, actor: "system", kind: "safety", input: { check: "call_start", direction: "inbound" }, decision: "allowed" });
    await store.appendRecord({ callId, actor: "agent", kind: "button", button: "lookup_patient", input: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" }, output: { result: { ok: true, output: {}, ruleIds: [] }, internal: { lookupId: "lk_1", matched: true, patientId: IDS.sam } } });
    await store.appendRecord({ callId, actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "lk_1", code: HAMMER_CODE }, output: { result: { ok: true, output: { verified: true }, ruleIds: [] }, internal: { patientId: IDS.sam } } });
  }
  const appt = (over: Record<string, unknown> = {}) => ({
    appointmentId: "apt_x_1", slotId: "ap_consult_20261126_1000", patientId: IDS.sam, type: "consult", start: "2026-11-26T10:00:00-05:00", ...over,
  });
  const book = (store: ReturnType<typeof createMemoryStore>, callId: string, a: Record<string, unknown>, button: "book_appointment" | "cancel_appointment" = "book_appointment") =>
    store.appendRecord({ callId, actor: "agent", kind: "button", button, input: {}, output: { result: { ok: true, output: { ok: true }, ruleIds: [] }, internal: { appointment: a } }, decision: "allowed" });
  const rulesFor = async (store: ReturnType<typeof createMemoryStore>, entry: Awaited<ReturnType<typeof book>>) => (await checker.check(store, entry)).map((b) => b.rule);

  it("a booking on a call nobody verified, or for another patient", async () => {
    const store = createMemoryStore(SEED);
    expect(await rulesFor(store, await book(store, "c_u", appt()))).toContain("appointment for someone who isn't the verified patient");
    await verifiedSam(store, "c_b");
    expect(await rulesFor(store, await book(store, "c_b", appt({ patientId: IDS.p4 })))).toContain("appointment for someone who isn't the verified patient");
  });

  it("a double booking, a second of a type that day, a forged hour, a slot weeks away", async () => {
    const store = createMemoryStore(SEED);
    await verifiedSam(store, "c_b");
    expect(await rulesFor(store, await book(store, "c_b", appt()))).not.toContain("appointment booked that a rule forbids");
    expect(await rulesFor(store, await book(store, "c_b", appt({ appointmentId: "apt_x_2" })))).toContain("appointment booked that a rule forbids");
    expect(await rulesFor(store, await book(store, "c_b", appt({ appointmentId: "apt_x_3", slotId: "ap_consult_20261126_1400", start: "2026-11-26T14:00:00-05:00" })))).toContain("appointment booked that a rule forbids");
    expect(await rulesFor(store, await book(store, "c_b", appt({ appointmentId: "apt_x_4", type: "vaccine", slotId: "ap_vaccine_20261127_2200", start: "2026-11-27T22:00:00-05:00" })))).toContain("appointment booked that a rule forbids");
    expect(await rulesFor(store, await book(store, "c_b", appt({ appointmentId: "apt_x_5", type: "pickup", slotId: "ap_pickup_20270105_1200", start: "2027-01-05T12:00:00-05:00" })))).toContain("appointment booked that a rule forbids");
  });

  it("a cancel of someone else's appointment", async () => {
    const store = createMemoryStore(SEED);
    await verifiedSam(store, "c_b");
    expect(await rulesFor(store, await book(store, "c_b", appt({ patientId: IDS.p2 }), "cancel_appointment"))).toContain("appointment cancelled that isn't the verified patient's");
  });

  it("an order for a longer supply than prescribed, or a quantity not from the label", async () => {
    const store = createMemoryStore(SEED);
    await store.saveOrder({ id: "o_long", rxId: IDS.p6Amlodipine, patientId: IDS.p6, state: "queued", createdAt: SEED.now, daysSupply: 31, quantity: 31 });
    await store.saveOrder({ id: "o_qty", rxId: IDS.samMetformin, patientId: IDS.sam, state: "queued", createdAt: SEED.now, daysSupply: 7, quantity: 7 });
    await store.saveOrder({ id: "o_ok", rxId: IDS.samMetformin, patientId: IDS.sam, state: "queued", createdAt: SEED.now, daysSupply: 7, quantity: 14 });
    const broken = await checker.check(store, undefined);
    expect(broken).toContainEqual(expect.objectContaining({ rule: "refill supply longer than prescribed", detail: expect.stringContaining("o_long") }));
    expect(broken).toContainEqual(expect.objectContaining({ rule: "refill quantity not worked out from the label", detail: expect.stringContaining("o_qty") }));
    expect(broken.map((b) => b.detail).join(" ")).not.toContain("o_ok");
  });

  it("a spoken appointment booking nobody made, or on another day", async () => {
    const store = createMemoryStore(SEED);
    await verifiedSam(store, "c_b");
    const line = (text: string) => store.appendRecord({ callId: "c_b", actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
    expect(await rulesFor(store, await line("Your consult is booked for Thursday."))).toContain("spoken line promises an appointment nobody booked");
    await book(store, "c_b", appt());
    expect(await rulesFor(store, await line("Your consult is booked for Thursday."))).not.toContain("spoken line promises an appointment nobody booked");
    expect(await rulesFor(store, await line("Your consult is booked for Friday."))).toContain("spoken line promises an appointment nobody booked");
  });

  it("a pickup appointment backs a spoken pickup day, never a delivery day", async () => {
    const store = createMemoryStore(SEED);
    await verifiedSam(store, "c_b");
    await book(store, "c_b", appt({ type: "pickup", slotId: "ap_pickup_20261124_1200", start: "2026-11-24T12:00:00-05:00" }));
    const line = (text: string) => store.appendRecord({ callId: "c_b", actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
    expect(await rulesFor(store, await line("Your pickup appointment is Tuesday at noon."))).not.toContain("spoken line promises a delivery day nobody booked");
    expect(await rulesFor(store, await line("We'll deliver it Tuesday."))).toContain("spoken line promises a delivery day nobody booked");
  });

  it("the alphabet attacks the Trail #85 buttons", () => {
    const pressed = new Set(ALL_ACTIONS.map((a) => a.label));
    for (const label of ["book consult thu 10", "book for dev", "cancel forged appointment", "history dev adderall", "refill sam metformin 91 days", "refill dev adderall 7 days", "list with patient id", "say booked consult", "say eligible and deliver"]) {
      expect(pressed.has(label), label).toBe(true);
    }
  });

  it("a recorded rule context that doesn't match the prescription", async () => {
    const store = createMemoryStore(SEED);
    await store.saveCall({ id: "c_c", direction: "inbound", state: "verified", lockedPatientId: IDS.p4, startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] });
    const entry = await store.appendRecord({
      callId: "c_c",
      actor: "agent",
      kind: "button",
      button: "request_refill",
      input: { rx_id: IDS.p4Adderall },
      // Lies: Dev's Adderall was filled 20 days ago, so 4b must refuse.
      context: { "drug.controlled": true, "rx.days_since_last_fill": 29, "rx.prescribed_interval_days": 30, "policy.controlled_early_window_days": 3 },
      output: { result: { ok: true, output: { state: "waiting_for_pharmacist", order_id: "o_c" }, ruleIds: [] }, internal: { queueItemId: "q_planted" } },
    });
    const rules = (await checker.check(store, entry)).map((b) => b.rule);
    expect(rules).toContain("rule context doesn't match the prescription");
    expect(rules).toContain("refill queued that a rule forbids");
  });
});
