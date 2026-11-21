// Urgent 19:40 (Role 0, demo pass 8): Reset demo must start every call fresh. Call ids restart
// at c_0001 after a reset, so an open call's conversation must not reach the next c_0001.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModel, ModelRequest } from "@/lib/agent";
import { resetBusForTests } from "@/lib/events/bus";
import { resetRuntimeForTests } from "./_lib/runtime";
import { POST as startCall } from "./call/start/route";
import { POST as say } from "./call/[id]/say/route";
import { POST as reset } from "./demo/reset/route";

const seen: Pick<ModelRequest, "messages">[] = [];
const ended: string[] = [];

// The real agent driver, with a model that records what it's sent and always says "Okay."
vi.mock("@/lib/agent", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agent")>();
  const model: AgentModel = {
    async *turn(request) {
      seen.push({ messages: JSON.parse(JSON.stringify(request.messages)) });
      yield { type: "text", text: "Okay." };
      yield { type: "done", turn: { stop_reason: "end_turn", content: [{ type: "text", text: "Okay.", citations: null }] } as never };
    },
    endCall: (callId) => void ended.push(callId),
  };
  return { ...real, createClaudeModel: () => model };
});
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function inbound() {
  const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
  return (await res.json()) as { callId: string; phoneToken: string };
}

async function callerSays(call: { callId: string; phoneToken: string }, text: string) {
  const res = await say(
    new Request("http://test.local/api", { method: "POST", headers: { "x-phone-token": call.phoneToken }, body: JSON.stringify({ text }) }),
    params(call.callId),
  );
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.stubEnv("DEMO_CONTROLS", "on");
  resetBusForTests();
  await resetRuntimeForTests();
  seen.length = 0;
  ended.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("Reset demo with a call still open", () => {
  it("hangs the call up, and the next c_0001 starts with no earlier messages", async () => {
    const first = await inbound();
    await callerSays(first, "I need my Concerta refilled.");
    expect(JSON.stringify(seen.at(-1)?.messages)).toContain("Concerta");

    expect((await reset()).status).toBe(200);
    expect(ended).toContain(first.callId);

    const second = await inbound();
    expect(second.callId).toBe(first.callId);
    await callerSays(second, "Hello?");
    const sent = JSON.stringify(seen.at(-1)?.messages);
    expect(sent).toContain("Hello?");
    expect(sent).not.toContain("Concerta");
  });

  it("is fine with no calls at all", async () => {
    expect((await reset()).status).toBe(200);
    expect(ended).toEqual([]);
  });
});
