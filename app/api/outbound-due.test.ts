import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { notDueReason } from "./_lib/outbound";

// The daily check's "ring about this prescription today?" test, exported so read-only
// callers (the outreach sim, Trail #67) use the same function. Behaviour is unchanged:
// ["7"] when it isn't due, the refusing rule ids when the refill rules refuse, else null.
async function reason(patientId: string, rxId: string) {
  const store = createMemoryStore(SEED);
  const patient = (await store.getPatient(patientId))!;
  const rx = (await store.getPrescription(rxId))!;
  const before = (await store.listRecord()).length;
  const out = await notDueReason(store, patient, rx);
  expect((await store.listRecord()).length).toBe(before);
  return out;
}

describe("notDueReason (run-daily-check)", () => {
  it("says rule 7 when the supply runs out more than 3 days from now", async () => {
    expect(await reason(IDS.p2, IDS.p2Atorvastatin)).toEqual(["7"]);
  });

  it("gives the refusing rule when it's due but the refill rules refuse", async () => {
    expect(await reason(IDS.p3, IDS.p3Lisinopril)).toEqual(["2a"]);
  });

  it("is null when it's due and the refill would pass", async () => {
    expect(await reason(IDS.p5, IDS.p5Levothyroxine)).toBeNull();
  });
});
