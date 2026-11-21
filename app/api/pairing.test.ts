import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, RunDailyCheckResponse, StreamEvent } from "@/lib/contract";
import { forAudience } from "@/lib/events/audience";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { resolveAudience } from "./_lib/audience";
import { clearDevicesForTests } from "./_lib/devices";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { GET as claim } from "./phone/claim/route";
import { POST as pair } from "./phone/pair/route";
import { POST as runDailyCheck } from "./outbound/run-daily-check/route";

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
const post = (body: unknown) =>
  new Request("http://test.local/api/phone/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  session.approver = null;
  resetBusForTests();
  clearDevicesForTests();
  await resetRuntimeForTests();
});

describe("POST /api/phone/pair (Trail #19)", () => {
  it("is for signed-in staff only, and only for a known patient", async () => {
    expect((await pair(post({ patientId: IDS.sam }))).status).toBe(401);
    session.approver = PHARMACIST;
    expect((await pair(post({ patientId: "p_nobody" }))).status).toBe(404);
    const res = await pair(post({ patientId: IDS.sam }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toMatch(/^\/api\/phone\/claim\?code=[A-Za-z0-9_-]{16,}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/phone/claim", () => {
  it("sets an httpOnly device cookie once, then refuses the same link", async () => {
    session.approver = PHARMACIST;
    const { url } = (await (await pair(post({ patientId: IDS.sam }))).json()) as { url: string };
    session.approver = null;
    const first = await claim(new Request(`http://test.local${url}`));
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toMatch(/\/phone$/);
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^rg_device=[A-Za-z0-9_-]{32,};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect((await claim(new Request(`http://test.local${url}`))).status).toBe(400);
    expect((await claim(new Request("http://test.local/api/phone/claim?code=made-up"))).status).toBe(400);
  });
});

describe("rings (Trail #19)", () => {
  it("reach the public without a call id, and Sam's paired device with it", async () => {
    session.approver = PHARMACIST;
    const { callIds } = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    const { url } = (await (await pair(post({ patientId: IDS.sam }))).json()) as { url: string };
    session.approver = null;
    const cookie = ((await claim(new Request(`http://test.local${url}`))).headers.get("set-cookie") ?? "").split(";")[0];
    const calls = await Promise.all(callIds.map((id) => getStore().getCall(id)));
    const samCall = calls.find((c) => c?.targetPatientId === IDS.sam)!.id;
    const graceCall = calls.find((c) => c?.targetPatientId === IDS.p5)!.id;
    const ring = (callId: string): StreamEvent => ({ type: "phone", callId, kind: "ring", text: "Maple Street Pharmacy is calling" });

    const pub = await resolveAudience(new Request("http://test.local/api/events"));
    expect(pub).not.toBeInstanceOf(Response);
    expect(forAudience(ring(samCall), pub as never)).toEqual({ ...ring(samCall), callId: "" });

    const device = await resolveAudience(new Request("http://test.local/api/events", { headers: { cookie } }));
    expect(forAudience(ring(samCall), device as never)).toEqual(ring(samCall));
    expect(forAudience(ring(graceCall), device as never)).toBeNull();
  });
});
