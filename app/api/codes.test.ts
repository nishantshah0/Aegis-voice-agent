import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, resetRuntimeForTests } from "./_lib/runtime";
import { issuePhoneToken } from "./_lib/phone";
import { GET as callCode } from "./call/[id]/code/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const get = () => new Request("http://test.local/api");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  session.approver = null;
  vi.unstubAllEnvs();
  resetBusForTests();
  await resetRuntimeForTests();
});

async function samWithCode() {
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const events: StreamEvent[] = [];
  subscribe((d) => events.push(d.event));
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  return { callId: started.callId, events };
}

describe("verification codes (Trail #3)", () => {
  it("the server's control layer never puts the digits on the stream", async () => {
    const { events } = await samWithCode();
    const codeEvents = events.filter((e) => e.type === "phone" && e.kind === "code");
    expect(codeEvents.length).toBeGreaterThan(0);
    for (const e of codeEvents) expect(JSON.stringify(e)).not.toMatch(/\d{6}/);
  });

  it("GET /api/call/:id/code gives the code only to that call's phone token (Trail #3, second review)", async () => {
    const { callId } = await samWithCode();
    const expected = await getControl().codeFor(callId);
    const token = issuePhoneToken(callId)!;
    const withToken = (t: string) => new Request("http://test.local/api", { headers: { "x-phone-token": t } });
    expect(await (await callCode(withToken(token), params(callId))).json()).toEqual({ code: expected });

    // No token: 401, even with DEMO_CONTROLS=on.
    expect((await callCode(get(), params(callId))).status).toBe(401);
    vi.stubEnv("DEMO_CONTROLS", "on");
    expect((await callCode(get(), params(callId))).status).toBe(401);
    vi.unstubAllEnvs();

    // Signed-in staff never need a patient's code: 403.
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    expect((await callCode(get(), params(callId))).status).toBe(403);
    session.approver = null;

    // Another call's token: 403.
    const other = await getControl().startInboundCall();
    const otherToken = issuePhoneToken(other)!;
    expect((await callCode(withToken(otherToken), params(callId))).status).toBe(403);
  });

  it("answers 404 when the call has no code", async () => {
    const callId = await getControl().startInboundCall();
    const token = issuePhoneToken(callId)!;
    expect((await callCode(new Request("http://test.local/api", { headers: { "x-phone-token": token } }), params(callId))).status).toBe(404);
  });
});
