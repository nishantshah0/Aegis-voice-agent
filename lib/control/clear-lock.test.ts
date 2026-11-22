// Trail #86: a signed-in pharmacist can clear a patient's code lockout early. Not a button: the
// AI can never unlock anyone. The clear is a record entry, and the lockout reads it.
import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { clearPatientCodeLock, patientCodeLock } from "./clear-lock";
import { createControl } from "./press";

const CODE = "112358";
const SAM = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };
const pharmacist = { id: "u_ph", name: "Test Pharmacist", role: "pharmacist" as const };
const reviewer = { id: "u_rv", name: "Test Reviewer", role: "reviewer" as const };

async function locked() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const guess = async (code: string) => {
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", SAM);
    return control.press(callId, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code });
  };
  await guess("000001");
  await guess("000002");
  await guess("000003");
  return { store, control, guess };
}

describe("clearing a patient's code lockout", () => {
  it("reports the lock, and a pharmacist's clear ends it on the next call, with a record entry", async () => {
    const { store, guess } = await locked();
    expect(await patientCodeLock(store, IDS.sam)).toEqual({ lockedUntil: "2026-11-24T15:15:00.000Z" });
    expect(await clearPatientCodeLock(store, IDS.sam, pharmacist)).toMatchObject({ ok: true });
    expect(await patientCodeLock(store, IDS.sam)).toEqual({ lockedUntil: undefined });
    const entry = (await store.listRecord()).at(-1)!;
    expect(entry).toMatchObject({ actor: "pharmacist", kind: "approval", decision: "allowed", input: { change: "clear_code_lock", patientId: IDS.sam, approver: { id: "u_ph", name: "Test Pharmacist" } } });
    expect(findBrokenLink(await store.listRecord())).toBeNull();
    // The hour's three codes are spent (rule: 3 codes an hour), so move on an hour to get a fresh code.
    await store.setNow("2026-11-24T11:00:30-05:00");
    await clearPatientCodeLock(store, IDS.sam, pharmacist);
    expect(await guess(CODE)).toMatchObject({ output: { verified: true } });
  });

  it("only wrong codes after the clear count towards a new lock", async () => {
    const { store, guess } = await locked();
    await clearPatientCodeLock(store, IDS.sam, pharmacist);
    await store.setNow("2026-11-24T11:01:00-05:00");
    expect(await guess("000004")).toMatchObject({ output: { verified: false, tries_left: 2 } });
    expect(await patientCodeLock(store, IDS.sam)).toEqual({ lockedUntil: undefined });
  });

  it("also clears the daily lock (six wrong codes in 24 hours)", async () => {
    const store = createMemoryStore(SEED);
    for (let h = 0; h < 6; h++) {
      await store.setNow(new Date(Date.parse(SEED.now) + h * 3600 * 1000).toISOString());
      await store.appendRecord({ callId: `c_${h}`, actor: "agent", kind: "button", button: "check_code", input: {}, output: { result: { ok: true, output: { verified: false }, ruleIds: [] }, internal: { patientId: IDS.sam, codeFailed: true } }, decision: "blocked" });
    }
    expect((await patientCodeLock(store, IDS.sam)).lockedUntil).toBeDefined();
    await clearPatientCodeLock(store, IDS.sam, pharmacist);
    expect((await patientCodeLock(store, IDS.sam)).lockedUntil).toBeUndefined();
  });

  it("refuses anyone but a pharmacist, an unknown patient, and changes nothing", async () => {
    const { store } = await locked();
    const before = (await store.listRecord()).length;
    expect(await clearPatientCodeLock(store, IDS.sam, reviewer)).toMatchObject({ ok: false });
    expect(await clearPatientCodeLock(store, "p_nobody", pharmacist)).toMatchObject({ ok: false });
    expect((await store.listRecord()).length).toBe(before);
    expect((await patientCodeLock(store, IDS.sam)).lockedUntil).toBeDefined();
  });

  it("a clear is not an approval of anything: it raises no signal and moves no request", async () => {
    const { store } = await locked();
    await clearPatientCodeLock(store, IDS.sam, pharmacist);
    const entry = (await store.listRecord()).at(-1)!;
    expect((entry.output as { status?: string }).status).not.toBe("approved");
    expect((await store.listRecord()).filter((e) => (e.input as { check?: string })?.check === "relane")).toHaveLength(0);
  });
});
