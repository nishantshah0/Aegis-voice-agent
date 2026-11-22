// check_code's verified output names the prescription whose number the caller gave
// in lookup_patient (matched_rx_id), so the agent doesn't ask "Concerta or Metformin?"
// after Sam has said RX-100201 (final Sonnet run, mild_side_effect attempt 1).
// Narrow on purpose: only on a verified result, only that patient's own prescription,
// never an rx_number on the list, and nothing new on any unverified result.

import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

const CODE = "135791";

async function inbound(name: string, dob: string, rxNumber: string) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const callId = await control.startInboundCall();
  const looked = await control.press(callId, "lookup_patient", { name, dob, rx_number: rxNumber });
  if (!looked.ok) throw new Error("lookup refused");
  return { store, control, callId, lookupId: looked.output.lookup_id };
}

describe("check_code names the prescription the caller gave (matched_rx_id)", () => {
  it("verified with Sam's RX-100201 gives rx_sam_concerta", async () => {
    const t = await inbound("Sam Rivera", "1990-03-14", "RX-100201");
    const r = await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: CODE });
    expect(r).toMatchObject({ ok: true, output: { verified: true, matched_rx_id: IDS.samConcerta } });
  });

  it("verified with Sam's other number gives that prescription, however the number is written", async () => {
    const t = await inbound("Sam Rivera", "1990-03-14", "rx 100202");
    const r = await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: CODE });
    expect(r).toMatchObject({ ok: true, output: { verified: true, matched_rx_id: IDS.samMetformin } });
  });

  it("the list of prescriptions still carries no prescription numbers", async () => {
    const t = await inbound("Sam Rivera", "1990-03-14", "RX-100201");
    const r = await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: CODE });
    if (!r.ok || !("verified" in r.output) || !r.output.verified) throw new Error("not verified");
    for (const rx of r.output.prescriptions) expect(Object.keys(rx).sort()).toEqual(["drug", "rx_id"]);
    expect(JSON.stringify(r.output)).not.toContain("RX-100201");
  });

  it("an unverified result carries nothing new: a wrong code", async () => {
    const t = await inbound("Sam Rivera", "1990-03-14", "RX-100201");
    const r = await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: "000000" });
    expect(r).toMatchObject({ ok: true, output: { verified: false } });
    expect(JSON.stringify(r)).not.toContain("matched_rx_id");
    expect(JSON.stringify(r)).not.toContain(IDS.samConcerta);
  });

  it("another patient's RX number never matches: Sam's name and birthday with Jordan's number verifies nobody", async () => {
    const t = await inbound("Sam Rivera", "1990-03-14", "RX-100301");
    const r = await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: CODE });
    expect(JSON.stringify(r)).not.toContain("matched_rx_id");
    expect(JSON.stringify(r)).not.toContain(IDS.p2Atorvastatin);
    expect((await t.store.getCall(t.callId))?.state).not.toBe("verified");
  });

  it("the lookup's output is unchanged: the same words whether or not anything matched", async () => {
    const matched = await inbound("Sam Rivera", "1990-03-14", "RX-100201");
    const unmatched = await inbound("Sam Rivera", "1990-03-14", "RX-999999");
    const a = (await matched.store.listRecord(matched.callId)).find((e) => e.button === "lookup_patient");
    const b = (await unmatched.store.listRecord(unmatched.callId)).find((e) => e.button === "lookup_patient");
    const outputOf = (e: typeof a) => JSON.stringify((e?.output as { result?: unknown })?.result);
    expect(outputOf(a)).toBe(outputOf(b));
  });

  it("an outbound call (no lookup_patient) gets no matched_rx_id: it already knows its prescription", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => CODE });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    const r = await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" });
    expect(r).toMatchObject({ ok: true, output: { verified: true } });
    expect(JSON.stringify(r)).not.toContain("matched_rx_id");
  });
});
