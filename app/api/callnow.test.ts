import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS, SEED } from "@/lib/seed";
import { ringTarget } from "./_lib/devices";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as callNow } from "./outbound/call-now/route";

const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const post = (body: unknown) =>
  new Request("http://test.local/api/outbound/call-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  session.approver = null;
  vi.unstubAllEnvs();
  resetBusForTests();
  await resetRuntimeForTests();
});

describe("POST /api/outbound/call-now (2.9a)", () => {
  it("is for signed-in pharmacists, or a demo laptop with DEMO_CONTROLS=on", async () => {
    expect((await callNow(post({ patientId: IDS.sam, rxId: IDS.samConcerta }))).status).toBe(401);
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    expect((await callNow(post({ patientId: IDS.sam, rxId: IDS.samConcerta }))).status).toBe(403);
    session.approver = null;
    vi.stubEnv("DEMO_CONTROLS", "on");
    expect((await callNow(post({ patientId: IDS.sam, rxId: IDS.samConcerta }))).status).toBe(200);
  });

  it("rings the patient through the lock (rule 7), and not again while the call is open", async () => {
    session.approver = PHARMACIST;
    const events: StreamEvent[] = [];
    subscribe((d) => events.push(d.event));
    const res = await callNow(post({ patientId: IDS.sam, rxId: IDS.samConcerta }));
    expect(res.status).toBe(200);
    const { callId } = (await res.json()) as { callId: string };
    expect(await getStore().getCall(callId)).toMatchObject({ direction: "outbound", targetPatientId: IDS.sam });
    expect(events).toContainEqual(expect.objectContaining({ type: "phone", kind: "ring", callId }));
    expect(ringTarget(callId)).toBe(IDS.sam);
    expect((await callNow(post({ patientId: IDS.sam, rxId: IDS.samConcerta }))).status).toBe(409);
  });

  it("refuses what rule 7 refuses, and prescriptions that aren't the patient's", async () => {
    session.approver = PHARMACIST;
    const notOptedIn = SEED.patients.find((p) => !p.optedInToCalls)!;
    const theirRx = SEED.prescriptions.find((r) => r.patientId === notOptedIn.id)!;
    const refused = await callNow(post({ patientId: notOptedIn.id, rxId: theirRx.id }));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { ruleIds: string[] }).ruleIds).toContain("7a");
    expect((await callNow(post({ patientId: IDS.sam, rxId: theirRx.id }))).status).toBe(404);
    expect((await callNow(post({ patientId: IDS.sam }))).status).toBe(400);
  });
});
