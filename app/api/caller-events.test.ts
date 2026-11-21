// Trail #19: what the say, answer and check-in responses hand the caller is shaped like the
// phone audience on the stream. A blocked line's original (the sentence S1-S4 stopped) never
// goes back, and presses carry only their outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, CallId } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { forCaller } from "@/lib/events/audience";
import { getControl, resetRuntimeForTests } from "./_lib/runtime";
import { POST as startCall } from "./call/start/route";
import { POST as answer } from "./call/[id]/answer/route";
import { POST as say } from "./call/[id]/say/route";
import { POST as checkIn } from "./call/[id]/check-in/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const LEAK = "Your prescription RX-100201 is ready.";
// A fooled agent: it tries to read out Sam's prescription, the guard stops it, and the press it
// made carries Sam's details in its input and output.
const leaky: AgentEvent[] = [
  { type: "blocked_line", rule: "S1", original: LEAK, replacement: "I can't share that yet." },
  { type: "press", button: "lookup_patient", input: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" }, result: { ok: true, output: { lookup_id: "lk_1", message: "code sent if matched" }, ruleIds: [] } },
  { type: "line", text: "I can't share that yet." },
];
async function* play(): AsyncIterable<AgentEvent> {
  for (const e of leaky) yield e;
}
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  const driver = {
    startCall: (opts: Parameters<ReturnType<typeof real.getControl>["startCall"]>[0]) => real.getControl().startCall(opts),
    callerSays: () => play(),
    endCall: async (callId: CallId) => real.getControl().endCall(callId),
    opening: () => play(),
    checkIn: () => play(),
  };
  return { ...real, getDriver: () => driver };
});

const post = (body: unknown, token?: string) =>
  new Request("http://test.local/api", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-phone-token": token } : {}) }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
  void getControl();
});

async function inbound(): Promise<{ callId: string; phoneToken: string }> {
  return (await (await startCall(post({ direction: "inbound" }))).json()) as { callId: string; phoneToken: string };
}

function expectShaped(events: AgentEvent[]) {
  expect(JSON.stringify(events)).not.toContain("RX-100201");
  expect(JSON.stringify(events)).not.toContain("1990-03-14");
  expect(events.find((e) => e.type === "blocked_line")).toMatchObject({ rule: "S1", original: "", replacement: "I can't share that yet." });
  expect(events.find((e) => e.type === "press")).toMatchObject({ button: "lookup_patient", result: { ok: true } });
  expect(events.find((e) => e.type === "line")).toEqual({ type: "line", text: "I can't share that yet." });
}

describe("the caller's responses never carry what the guard stopped", () => {
  it("forCaller blanks a blocked original and keeps only a press's outcome", () => {
    expectShaped(leaky.map(forCaller));
  });

  it("say", async () => {
    const { callId, phoneToken } = await inbound();
    const res = await say(post({ text: "What's on my prescription?" }, phoneToken), params(callId));
    expect(res.status).toBe(200);
    expectShaped(((await res.json()) as { events: AgentEvent[] }).events);
  });

  it("answer", async () => {
    const { callId, phoneToken } = await inbound();
    const res = await answer(post({}, phoneToken), params(callId));
    expect(res.status).toBe(200);
    expectShaped(((await res.json()) as { events: AgentEvent[] }).events);
  });

  it("check-in", async () => {
    const { callId, phoneToken } = await inbound();
    const res = await checkIn(post({}, phoneToken), params(callId));
    expect(res.status).toBe(200);
    expectShaped(((await res.json()) as { events: AgentEvent[] }).events);
  });
});
