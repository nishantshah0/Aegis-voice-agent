import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl, MAX_CODE_TRIES } from "./press";

// Code review on main, finding 3 (high): SPEC Part 2 outbound step 2. An outbound call is verified
// only when the code AND the locked patient's date of birth check out. A missing or wrong date of
// birth is a failed try that counts towards the lockout. Inbound calls are unchanged (code only).
const SAM_DOB = "1990-03-14";
const sam = { name: "Sam Rivera", dob: SAM_DOB, rx_number: "RX-100201" };

async function outbound() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "111111" });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("refused");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  return { store, control, callId: started.callId, lookupId: started.lookupId };
}

describe("outbound check_code needs the date of birth", () => {
  it("the right code with no dob is a failed try and doesn't verify", async () => {
    const { store, control, callId, lookupId } = await outbound();
    const r = await control.press(callId, "check_code", { lookup_id: lookupId, code: "111111" });
    expect(r).toMatchObject({ ok: true, output: { verified: false, tries_left: MAX_CODE_TRIES - 1 } });
    expect((await store.getCall(callId))?.state).not.toBe("verified");
  });

  it("the right code with the wrong dob is a failed try", async () => {
    const { store, control, callId, lookupId } = await outbound();
    const r = await control.press(callId, "check_code", { lookup_id: lookupId, code: "111111", dob: "1990-03-15" });
    expect(r).toMatchObject({ ok: true, output: { verified: false } });
    expect((await store.getCall(callId))?.state).not.toBe("verified");
  });

  it("missing dobs count towards the lockout", async () => {
    const { control, callId, lookupId } = await outbound();
    let last: unknown;
    for (let i = 0; i < MAX_CODE_TRIES; i++) last = await control.press(callId, "check_code", { lookup_id: lookupId, code: "111111" });
    expect(last).toMatchObject({ ok: true, output: { locked_until: expect.any(String) } });
  });

  it("the right code and the right dob verify", async () => {
    const { store, control, callId, lookupId } = await outbound();
    const r = await control.press(callId, "check_code", { lookup_id: lookupId, code: "111111", dob: SAM_DOB });
    expect(r).toMatchObject({ ok: true, output: { verified: true } });
    expect((await store.getCall(callId))?.lockedPatientId).toBe(IDS.sam);
  });

  it("an inbound call still verifies with the code alone", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "222222" });
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", sam);
    const lookupId = (lookup as { output: { lookup_id: string } }).output.lookup_id;
    const r = await control.press(callId, "check_code", { lookup_id: lookupId, code: "222222" });
    expect(r).toMatchObject({ ok: true, output: { verified: true } });
  });
});
