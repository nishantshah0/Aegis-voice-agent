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
      output: { result: { ok: true, output: { state: "waiting_for_pharmacist", order_id: "o_z" }, ruleIds: [] }, internal: {} },
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
      output: { result: { ok: true, output: { state: "waiting_for_pharmacist", order_id: "o_c" }, ruleIds: [] }, internal: {} },
    });
    const rules = (await checker.check(store, entry)).map((b) => b.rule);
    expect(rules).toContain("rule context doesn't match the prescription");
    expect(rules).toContain("refill queued that a rule forbids");
  });
});
