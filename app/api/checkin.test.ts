import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { checkInCall, type JoinableDriver } from "./_lib/phone";
import { getControl, getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as startCall } from "./call/start/route";
import { POST as checkIn } from "./call/[id]/check-in/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const req = (token?: string) => new Request("http://test.local/api", { method: "POST", headers: token ? { "x-phone-token": token } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

describe("POST /api/call/:id/check-in (Role 1's 1.8)", () => {
  it("needs the call's phone token", async () => {
    const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
    const { callId } = (await res.json()) as { callId: string };
    expect((await checkIn(req(), params(callId))).status).toBe(401);
  });

  it("answers 204 when the driver has no check-in (the contract's fake)", async () => {
    const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
    const { callId, phoneToken } = (await res.json()) as { callId: string; phoneToken: string };
    expect((await checkIn(req(phoneToken), params(callId))).status).toBe(204);
  });

  it("answers 404 for an unknown call", async () => {
    expect((await checkIn(req("anything"), params("c_9999"))).status).toBe(404);
  });

  it("collects the driver's check-in events when it has one", async () => {
    const callId = await getControl().startInboundCall();
    const driver = {
      startCall: async () => "unused",
      callerSays: async function* () {},
      endCall: async () => {},
      checkIn: async function* (): AsyncIterable<AgentEvent> {
        yield { type: "line", text: "Are you still there?" };
      },
    } satisfies JoinableDriver;
    expect(await checkInCall(driver, callId)).toEqual([{ type: "line", text: "Are you still there?" }]);
    expect(await getStore().getCall(callId)).toBeDefined();
  });
});
