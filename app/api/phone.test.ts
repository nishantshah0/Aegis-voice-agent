import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, Approver, RunDailyCheckResponse } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "./_lib/runtime";
import { answerCall, type JoinableDriver } from "./_lib/phone";
import { POST as startCall } from "./call/start/route";
import { POST as say } from "./call/[id]/say/route";
import { POST as answer } from "./call/[id]/answer/route";
import { POST as end } from "./call/[id]/end/route";
import { GET as callCode } from "./call/[id]/code/route";
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

const req = (method: string, body?: unknown, token?: string) =>
  new Request("http://test.local/api", {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "x-phone-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Session = { callId: string; phoneToken: string };

beforeEach(async () => {
  session.approver = null;
  vi.unstubAllEnvs();
  resetBusForTests();
  await resetRuntimeForTests();
});

async function samRinging(): Promise<string> {
  session.approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
  const { callIds } = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
  session.approver = null;
  const calls = await Promise.all(callIds.map((id) => getStore().getCall(id)));
  return calls.find((c) => c?.targetPatientId === IDS.sam)!.id;
}

describe("the per-call phone token", () => {
  it("lets only the phone that started an inbound call speak into it", async () => {
    const { callId, phoneToken } = (await (await startCall(req("POST", { direction: "inbound" }))).json()) as Session;
    expect((await say(req("POST", { text: "Hello" }), params(callId))).status).toBe(401);
    expect((await say(req("POST", { text: "Hello" }, "wrong-token"), params(callId))).status).toBe(401);
    expect((await say(req("POST", { text: "Hello" }, phoneToken), params(callId))).status).toBe(200);
  });
});

describe("POST /api/call/:id/answer", () => {
  it("answers Sam's ringing call once, handing that phone its token", async () => {
    const callId = await samRinging();
    const first = await answer(req("POST"), params(callId));
    expect(first.status).toBe(200);
    const body = (await first.json()) as Session & { events: AgentEvent[] };
    expect(body.phoneToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(Array.isArray(body.events)).toBe(true);
    expect((await answer(req("POST"), params(callId))).status).toBe(409);
  });

  it("answers 404 for a call that doesn't exist", async () => {
    expect((await answer(req("POST"), params("c_9999"))).status).toBe(404);
  });

  it("joins the driver to an outbound call with the patient and prescription, then plays the opening", async () => {
    const callId = await samRinging();
    const joined: unknown[] = [];
    const driver = {
      startCall: async () => "unused",
      callerSays: async function* () {},
      endCall: async () => {},
      joinCall: (id: string, opts: unknown) => joined.push({ id, opts }),
      opening: async function* (): AsyncIterable<AgentEvent> {
        yield { type: "line", text: "Hi, this is Maple Street Pharmacy calling for Sam Rivera." };
      },
    } satisfies JoinableDriver;
    const events = await answerCall(driver, getStore(), callId);
    expect(joined).toEqual([
      { id: callId, opts: { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" } },
    ]);
    expect(events).toEqual([{ type: "line", text: "Hi, this is Maple Street Pharmacy calling for Sam Rivera." }]);
  });
});

describe("GET /api/call/:id/code with the phone token", () => {
  it("gives the code to the call's own phone and nobody else", async () => {
    const callId = await samRinging();
    const { phoneToken } = (await (await answer(req("POST"), params(callId))).json()) as Session;
    await getControl().press(callId, "send_code", { lookup_id: `out_${callId}` });
    expect(await (await callCode(req("GET", undefined, phoneToken), params(callId))).json()).toEqual({
      code: await getControl().codeFor(callId),
    });
    expect((await callCode(req("GET", undefined, "wrong-token"), params(callId))).status).toBe(401);
  });
});

describe("POST /api/call/:id/end", () => {
  it("ends the call for its phone, and refuses anyone else", async () => {
    const { callId, phoneToken } = (await (await startCall(req("POST", { direction: "inbound" }))).json()) as Session;
    expect((await end(req("POST"), params(callId))).status).toBe(401);
    expect((await end(req("POST", undefined, phoneToken), params(callId))).status).toBe(204);
    expect((await getStore().getCall(callId))?.state).toBe("ended");
  });
});
