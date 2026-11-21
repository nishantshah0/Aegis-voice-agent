import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, resetRuntimeForTests } from "./_lib/runtime";
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

  it("GET /api/call/:id/code refuses someone not signed in", async () => {
    const { callId } = await samWithCode();
    expect((await callCode(get(), params(callId))).status).toBe(401);
  });

  it("gives the code to signed-in staff, and on a demo laptop with DEMO_CONTROLS=on", async () => {
    const { callId } = await samWithCode();
    const expected = await getControl().codeFor(callId);
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    expect(await (await callCode(get(), params(callId))).json()).toEqual({ code: expected });
    session.approver = null;
    vi.stubEnv("DEMO_CONTROLS", "on");
    expect(await (await callCode(get(), params(callId))).json()).toEqual({ code: expected });
  });

  it("answers 404 when the call has no code", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    const callId = await getControl().startInboundCall();
    expect((await callCode(get(), params(callId))).status).toBe(404);
  });
});
