import { beforeEach, describe, expect, it } from "vitest";
import type { Approver } from "@/lib/contract";
import { clearPatientCodeLock } from "@/lib/control";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { upcoming } from "@/app/console/upcoming/upcoming";
import { callDetail } from "./calls/[id]/detail";

// Trail #86: where a pharmacist finds a locked-out patient. Upcoming's rows and the call page
// carry the patient's lockedUntil (from lib/control's patientCodeLock), and lose it once cleared.

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

/** Sam's outbound call with three wrong codes inside 15 minutes. */
async function lockSamOut(): Promise<string> {
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  for (const code of ["000001", "000002", "000003"]) await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code, dob: "1990-03-14" });
  return started.callId;
}

describe("a locked-out patient in the pharmacy views (Trail #86)", () => {
  it("Upcoming marks every row of a locked-out patient with lockedUntil, and only theirs", async () => {
    await lockSamOut();
    const { rows } = await upcoming(getStore());
    const sams = rows.filter((r) => r.patientId === IDS.sam);
    expect(sams.length).toBeGreaterThan(0);
    for (const r of sams) expect(r.lockedUntil).toBeDefined();
    for (const r of rows.filter((r) => r.patientId !== IDS.sam)) expect(r.lockedUntil).toBeUndefined();
  });

  it("the call page carries the call's patient and their lockedUntil", async () => {
    const callId = await lockSamOut();
    const detail = (await callDetail(getStore(), callId))!;
    expect(detail.patientId).toBe(IDS.sam);
    expect(detail.lockedUntil).toBeDefined();
  });

  it("both lose it once a pharmacist clears the lockout", async () => {
    const callId = await lockSamOut();
    expect((await clearPatientCodeLock(getStore(), IDS.sam, PHARMACIST)).ok).toBe(true);
    expect((await upcoming(getStore())).rows.filter((r) => r.patientId === IDS.sam).every((r) => r.lockedUntil === undefined)).toBe(true);
    expect((await callDetail(getStore(), callId))!.lockedUntil).toBeUndefined();
  });
});
