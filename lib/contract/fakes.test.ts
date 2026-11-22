import { describe, expect, it } from "vitest";
import { BUTTON_NAMES, BUTTON_TIERS, STARTING_CARDS, type StreamEvent } from "./index";
import { createFakes, DEMO_NOW, FAKE_CODE, SAM_CONCERTA, SAM_ID } from "./fakes";

const pharmacist = { id: "u_test", name: "Test Pharmacist", role: "pharmacist" as const };

describe("contract", () => {
  it("has exactly 16 buttons (the 12, plus Trail #85's four), each with a tier", () => {
    expect(BUTTON_NAMES).toHaveLength(16);
    expect(Object.keys(BUTTON_TIERS).sort()).toEqual([...BUTTON_NAMES].sort());
  });

  it("starting cards never allow anything", () => {
    for (const card of STARTING_CARDS) expect(["refuse", "route", "flag"]).toContain(card.then);
  });
});

describe("fakes", () => {
  it("runs Sam's inbound typed call: verify, refill routed to Quick check, approved", async () => {
    const events: StreamEvent[] = [];
    const { store, press, driver } = createFakes((e) => events.push(e));
    expect(await store.now()).toBe(DEMO_NOW);

    const callId = await driver.startCall({ direction: "inbound" });
    expect((await press(callId, "read_label", { rx_id: SAM_CONCERTA })).ok).toBe(false);

    const lookup = await press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    if (!lookup.ok) throw new Error("lookup failed");
    const check = await press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code: FAKE_CODE });
    expect(check.ok && check.output).toMatchObject({ verified: true, patient_first_name: "Sam", prescriptions: [{ rx_id: SAM_CONCERTA, drug: "Concerta" }, { rx_id: "rx_sam_metformin", drug: "Metformin" }] });

    const refill = await press(callId, "request_refill", { rx_id: SAM_CONCERTA });
    expect(refill.ok && refill.output.state).toBe("waiting_for_pharmacist");
    expect(refill.ok && refill.lane).toBe("quick_check");

    const [item] = await store.queue("quick_check");
    const decided = await store.decide(item.id, "approve", pharmacist);
    expect(decided.decidedBy?.name).toBe("Test Pharmacist");

    const record = await store.listRecord(callId);
    expect(record.at(-1)?.kind).toBe("approval");
    for (let i = 1; i < record.length; i++) expect(record[i].prevHash).toBe(record[i - 1].hash);
    expect(events.some((e) => e.type === "press" && e.decision === "routed")).toBe(true);
  });

  it("refuses another patient's prescription and wrong codes lock after 3", async () => {
    const { press, driver } = createFakes();
    const callId = await driver.startCall({ direction: "outbound", patientId: SAM_ID });
    for (const tries of [2, 1]) {
      const r = await press(callId, "check_code", { lookup_id: "none", code: "000000" });
      expect(r.ok && r.output).toEqual({ verified: false, tries_left: tries });
    }
    const locked = await press(callId, "check_code", { lookup_id: "none", code: "000000" });
    expect(locked.ok && "locked_until" in locked.output).toBe(true);
  });

  it("reset gives the same state every time", async () => {
    const { store, driver } = createFakes();
    await driver.startCall({ direction: "inbound" });
    await store.reset((await import("./fakes")).FAKE_SEED);
    expect(await store.listRecord()).toEqual([]);
    expect((await store.getPrescriptions(SAM_ID)).map((r) => r.id)).toContain(SAM_CONCERTA);
  });

  it("fake guard blocks a drug name before verification", async () => {
    const { guardSentence, driver } = createFakes();
    const callId = await driver.startCall({ direction: "inbound" });
    const r = await guardSentence(callId, "Your Concerta is ready.");
    expect(r.blocked && r.rule).toBe("S1");
  });
});
