import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { patientCodeLock } from "@/lib/control";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as clearLock } from "./patients/[id]/code-lock/clear/route";

// POST /api/patients/:id/code-lock/clear (Trail #86, Role 2 stand-in): a signed-in pharmacist
// clears a patient's code lockout through lib/control's clearPatientCodeLock. The approver comes
// from the session, never the body; the clear is a pharmacist approval entry in the record.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const REVIEWER: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("http://test.local/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

beforeEach(async () => {
  session.approver = null;
  resetBusForTests();
  await resetRuntimeForTests();
});

/** Three wrong codes for Sam on one call, inside 15 minutes: the patient lock holds. */
async function lockSamOut() {
  const control = getControl();
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup failed");
  for (const code of ["000001", "000002", "000003"]) await control.press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code });
  const { lockedUntil } = await patientCodeLock(getStore(), IDS.sam);
  expect(lockedUntil).toBeDefined();
}

describe("POST /api/patients/:id/code-lock/clear", () => {
  it("needs a signed-in pharmacist: 401 signed out, 403 for a reviewer, and nothing is written", async () => {
    await lockSamOut();
    const before = (await getStore().listRecord()).length;
    expect((await clearLock(post(), params(IDS.sam))).status).toBe(401);
    session.approver = REVIEWER;
    expect((await clearLock(post(), params(IDS.sam))).status).toBe(403);
    expect((await getStore().listRecord()).length).toBe(before);
    expect((await patientCodeLock(getStore(), IDS.sam)).lockedUntil).toBeDefined();
  });

  it("answers 404 for a patient who doesn't exist", async () => {
    session.approver = PHARMACIST;
    expect((await clearLock(post(), params("p_nobody"))).status).toBe(404);
  });

  it("clears the lock and records a pharmacist approval with the session's approver, never the body's", async () => {
    await lockSamOut();
    session.approver = PHARMACIST;
    const res = await clearLock(post({ approver: { id: "x", name: "Someone Else", role: "pharmacist" } }), params(IDS.sam));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; at: string };
    expect(body).toMatchObject({ ok: true });
    expect(body.at).toBe(await getStore().now());
    expect((await patientCodeLock(getStore(), IDS.sam)).lockedUntil).toBeUndefined();
    const entry = (await getStore().listRecord()).at(-1)!;
    expect(entry).toMatchObject({ kind: "approval", actor: "pharmacist", input: { change: "clear_code_lock", patientId: IDS.sam, approver: { id: PHARMACIST.id, name: PHARMACIST.name } } });
  });
});
