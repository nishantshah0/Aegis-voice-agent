import { describe, expect, it } from "vitest";
import type { Seed } from "@/lib/contract";
import { createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl } from "./press";

async function fixture(rxId: string = IDS.samConcerta, seed: Seed = SEED) {
  const store = createMemoryStore(seed);
  const rx = (await store.getPrescription(rxId))!;
  const p = (await store.getPatient(rx.patientId))!;
  const control = createControl({ store, makeCode: () => "246135" });
  const guard = createSpeechGuard({ store });
  const callId = await control.startInboundCall();
  const press = control.press.bind(null, callId);
  const verify = async () => {
    const lookup = await control.press(callId, "lookup_patient", { name: p.firstName + " " + p.lastName, dob: p.dob, rx_number: rx.rxNumber });
    if (!lookup.ok) throw new Error("lookup failed");
    await press("check_code", { lookup_id: lookup.output.lookup_id, code: "246135" });
  };
  const history = () => control.press(callId, "check_prescription", { rx_id: rxId, include_other_names: false });
  const quote = (rx_id = rxId, days_supply?: number) => control.press(callId, "check_coverage", { rx_id, ...(days_supply === undefined ? {} : { days_supply }) });
  return { verify, history, quote, speak: (line: string) => guard(callId, line) };
}

describe("verified patient facts", () => {
  it("reads the last dispense, distinct from the prescribed dose or supply length", async () => {
    const f = await fixture(IDS.samMetformin);
    expect(await f.history()).toMatchObject({ ok: false });
    await f.verify();
    const history = await f.history();
    if (!history.ok) throw new Error("history missing");
    expect(history.output).toMatchObject({ days_supplied: 90, last_quantity: 180, last_quantity_unit: "tablets" });
    expect(history.output.history_readback).toContain("180 tablets for a 90-day supply");
    expect(await f.speak(history.output.history_readback)).toMatchObject({ blocked: false });
    expect(await f.speak(history.output.history_readback.replace("180 tablets", "90 tablets"))).toMatchObject({ blocked: true });
    expect(await f.speak(history.output.history_readback.replace("2026", "2025"))).toMatchObject({ blocked: true });
    expect(await f.speak("Your last refill was yesterday.")).toMatchObject({ blocked: true });
  });

  it("does not infer a dispensed quantity from the current label on older records", async () => {
    const seed = structuredClone(SEED);
    delete seed.prescriptions.find(rx => rx.id === IDS.samMetformin)!.lastDispensedQuantity;
    const f = await fixture(IDS.samMetformin, seed);
    await f.verify();
    expect(await f.history()).toMatchObject({ ok: true, output: { last_quantity: null, history_readback: expect.stringContaining("quantity is not recorded") } });
  });

  it("only quotes the insurance figures actually recorded for this prescription and supply", async () => {
    const f = await fixture(IDS.p6Amlodipine);
    expect(await f.quote(undefined, 7)).toMatchObject({ ok: false, error: "not_verified" });
    await f.verify();
    expect(await f.quote(IDS.samConcerta, 7)).toMatchObject({ ok: false, error: "not_yours" });
    const seven = await f.quote(undefined, 7);
    if (!seven.ok) throw new Error("quote missing");
    expect(seven.output).toMatchObject({ available: true, days_supply: 7, plan_pays: "$3.25", patient_pays: "$1.25" });
    expect(await f.speak(seven.output.coverage_readback)).toMatchObject({ blocked: false });
    expect(await f.speak("For a 14-day supply of Amlodipine, you pay $1.25.")).toMatchObject({ blocked: true });
    expect(await f.quote(undefined, 14)).toMatchObject({ ok: true, output: { available: false, days_supply: 14, plan_pays: null, patient_pays: null } });
    expect(await f.speak("Your copay is $1.25.")).toMatchObject({ blocked: true });
  });

  it("blocks swapped shares and prices borrowed from another of the caller's prescriptions", async () => {
    const f = await fixture();
    await f.verify();
    await f.quote(IDS.samConcerta);
    await f.quote(IDS.samMetformin);
    for (const line of ["Your plan pays $4.10 for Concerta.", "Your Metformin costs you $4.10.", "You pay $41.20 for Concerta.", "Your copay is free.", "On your plan it's fifty dollars.", "You owe 45 bucks.", "Your copay is 19.95."]) {
      expect((await f.speak(line)).blocked, line).toBe(true);
    }
  });

  it("marks missing or non-monetary insurance data as unavailable", async () => {
    const seed = structuredClone(SEED);
    seed.prescriptions.find(rx => rx.id === IDS.samConcerta)!.patientPays = "simulated";
    const f = await fixture(IDS.samConcerta, seed);
    await f.verify();
    const quote = await f.quote();
    if (!quote.ok) throw new Error("quote missing");
    expect(quote.output).toMatchObject({ available: false, plan_pays: null, patient_pays: null });
    expect(await f.speak(quote.output.coverage_readback)).toMatchObject({ blocked: false });
    expect(await f.speak("You pay $0.00.")).toMatchObject({ blocked: true });
  });
});
