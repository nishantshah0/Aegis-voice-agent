// Trail #86 (RT-C1, RT-C2): the code lockout and the failed-code signal belong to the patient,
// worked out from the record, so hanging up and redialing never buys more guesses.
import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl } from "./press";

const CODE = "112358";
const SAM = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };

function lock() {
  const store = createMemoryStore(SEED);
  return { store, control: createControl({ store, makeCode: () => CODE }) };
}

async function guess(control: ReturnType<typeof lock>["control"], code: string) {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", SAM);
  const lookupId = lookup.ok ? lookup.output.lookup_id : "";
  return { callId, lookupId, result: await control.press(callId, "check_code", { lookup_id: lookupId, code }) };
}

describe("per-patient code lockout", () => {
  it("three wrong codes across three calls lock the patient for 15 minutes on any call", async () => {
    const { control, store } = lock();
    expect((await guess(control, "000001")).result).toMatchObject({ ok: true, output: { verified: false, tries_left: 2 } });
    expect((await guess(control, "000002")).result).toMatchObject({ ok: true, output: { verified: false, tries_left: 1 } });
    const third = await guess(control, "000003");
    expect(third.result).toMatchObject({ ok: true, output: { locked_until: "2026-11-24T15:15:00.000Z" } });
    // The right code on a fresh call is refused while the patient is locked.
    expect((await guess(control, CODE)).result).toMatchObject({ ok: true, output: { locked_until: "2026-11-24T15:15:00.000Z" } });
    await store.setNow("2026-11-24T10:14:59-05:00");
    expect((await guess(control, CODE)).result).toMatchObject({ output: { locked_until: expect.any(String) } });
    // After the lock (and after the hour's three codes, rule 3 codes per hour), a fresh call verifies.
    await store.setNow("2026-11-24T11:00:01-05:00");
    expect((await guess(control, CODE)).result).toMatchObject({ ok: true, output: { verified: true } });
  });

  it("the lock runs 15 minutes from the third wrong code, even when the first was 14 minutes earlier", async () => {
    const { control, store } = lock();
    await guess(control, "000001");
    await store.setNow("2026-11-24T10:14:00-05:00");
    await guess(control, "000002");
    await store.setNow("2026-11-24T10:14:30-05:00");
    expect((await guess(control, "000003")).result).toMatchObject({ output: { locked_until: "2026-11-24T15:29:30.000Z" } });
    await store.setNow("2026-11-24T10:20:00-05:00");
    expect((await guess(control, CODE)).result).toMatchObject({ output: { locked_until: "2026-11-24T15:29:30.000Z" } });
  });

  it("three wrong codes more than 15 minutes apart don't lock", async () => {
    const { control, store } = lock();
    await guess(control, "000001");
    await store.setNow("2026-11-24T10:10:00-05:00");
    await guess(control, "000002");
    await store.setNow("2026-11-24T10:16:00-05:00");
    const third = await guess(control, "000003");
    expect(third.result).toMatchObject({ output: { verified: false } });
    // Same call, same code sent: the right one now verifies.
    expect(await control.press(third.callId, "check_code", { lookup_id: third.lookupId, code: CODE })).toMatchObject({ output: { verified: true } });
  });

  it("moving the clock back never ends a lock early", async () => {
    const { control, store } = lock();
    for (const c of ["000001", "000002", "000003"]) await guess(control, c);
    await store.setNow("2026-11-24T09:00:00-05:00");
    expect((await guess(control, CODE)).result).toMatchObject({ output: { locked_until: expect.any(String) } });
  });

  it("one patient's lock never locks another patient", async () => {
    const { control } = lock();
    for (const c of ["000001", "000002", "000003"]) await guess(control, c);
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" });
    const r = await control.press(callId, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: CODE });
    expect(r).toMatchObject({ output: { verified: true } });
  });

  it("a wrong code marks the record entry as a failed code for that patient; a locked answer doesn't", async () => {
    const { control, store } = lock();
    for (const c of ["000001", "000002", "000003", CODE]) await guess(control, c);
    const entries = (await store.listRecord()).filter((e) => e.button === "check_code");
    expect(entries.map((e) => (e.output as { internal: { codeFailed?: boolean } }).internal.codeFailed ?? false)).toEqual([true, true, true, false]);
    expect(entries.every((e) => (e.output as { internal: { patientId?: string } }).internal.patientId === IDS.sam)).toBe(true);
  });
});

describe("the failed-code signal follows the patient", () => {
  it("wrong codes on an earlier call send a later refill to Review, within the hour", async () => {
    const { control, store } = lock();
    await guess(control, "000001");
    const ok = await guess(control, CODE);
    expect(ok.result).toMatchObject({ output: { verified: true } });
    expect(await control.press(ok.callId, "request_refill", { rx_id: IDS.samMetformin })).toMatchObject({ lane: "review" });
    expect((await store.queue("review")).find((q) => q.rxId === IDS.samMetformin)?.signals).toContain("failed_code_attempts");
  });

  it("an hour later the old wrong code no longer counts", async () => {
    const { control, store } = lock();
    await guess(control, "000001");
    await store.setNow("2026-11-24T11:01:00-05:00");
    const ok = await guess(control, CODE);
    const r = await control.press(ok.callId, "request_refill", { rx_id: IDS.p6Amlodipine });
    expect(r).toMatchObject({ ok: false });
    // Sam's own non-controlled metformin is early (card 3), so look at signals, not the lane.
    await control.press(ok.callId, "request_refill", { rx_id: IDS.samMetformin });
    expect((await store.queue()).find((q) => q.rxId === IDS.samMetformin)?.signals).not.toContain("failed_code_attempts");
  });
});

describe("the daily cap on failed codes (Trail #86 review low)", () => {
  // Two wrong codes per call every 16 minutes never trips the 15-minute lock; six in a day does.
  async function spread(control: ReturnType<typeof lock>["control"], store: ReturnType<typeof lock>["store"], wrong: number) {
    let t = Date.parse("2026-11-24T10:00:00-05:00");
    let left = wrong;
    while (left > 0) {
      await store.setNow(new Date(t).toISOString());
      const first = await guess(control, `00000${left}`);
      left--;
      if (left > 0) {
        await control.press(first.callId, "check_code", { lookup_id: first.lookupId, code: `00001${left}` });
        left--;
      }
      // An hour on, so the three-codes-an-hour limit never stops the code going out.
      t += 61 * 60 * 1000;
    }
    return t;
  }

  it("five wrong codes in a day, never three in 15 minutes: the right code still verifies", async () => {
    const { control, store } = lock();
    const t = await spread(control, store, 5);
    await store.setNow(new Date(t).toISOString());
    expect((await guess(control, CODE)).result).toMatchObject({ output: { verified: true } });
  });

  it("the sixth wrong code in 24 hours locks the patient for 2 hours from it, on any call (the pharmacist can clear it sooner)", async () => {
    const { control, store } = lock();
    const t = await spread(control, store, 6);
    const failures = (await store.listRecord()).filter((e) => (e.output as { internal?: { codeFailed?: boolean } })?.internal?.codeFailed);
    expect(failures).toHaveLength(6);
    const sixth = Date.parse(failures[5].at);
    const lockedTo = new Date(sixth + 2 * 3600 * 1000).toISOString();
    expect((failures[5].output as { result: { output: unknown } }).result.output).toMatchObject({ locked_until: lockedTo });
    await store.setNow(new Date(Math.min(t, sixth + 3600 * 1000)).toISOString());
    expect((await guess(control, CODE)).result).toMatchObject({ output: { locked_until: lockedTo } });
    await store.setNow(new Date(sixth + 2 * 3600 * 1000 + 61 * 60 * 1000).toISOString());
    expect((await guess(control, CODE)).result).toMatchObject({ output: { verified: true } });
  });

  it("after the 2 hours, one more wrong code that day locks again at once", async () => {
    const { control, store } = lock();
    await spread(control, store, 6);
    const sixth = Date.parse((await store.listRecord()).filter((e) => (e.output as { internal?: { codeFailed?: boolean } })?.internal?.codeFailed).at(-1)!.at);
    await store.setNow(new Date(sixth + 3 * 3600 * 1000).toISOString());
    expect((await guess(control, "000099")).result).toMatchObject({ output: { locked_until: new Date(sixth + 5 * 3600 * 1000).toISOString() } });
  });
});
