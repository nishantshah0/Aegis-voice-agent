import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { inboundGreeting } from "@/lib/agent/lines";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import * as runtime from "./_lib/runtime";
import { resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { POST as llm } from "./voice/llm/[[...path]]/route";
import { POST as startCall } from "./call/start/route";

// Trail #70: the real phone line's custom LLM endpoint, called the way ElevenLabs Agents calls it.

const swap = vi.hoisted(() => ({ driver: undefined as AgentDriver | undefined }));
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  return { ...real, getDriver: () => swap.driver ?? real.getDriver() };
});
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const SECRET = "test-voice-secret-0123456789";

type Msg = { role: "system" | "user" | "assistant"; content: string };
const system = (conversation = "conv_test_1"): Msg => ({ role: "system", content: `[aegis-conversation:${conversation}] The pharmacy's server answers.` });

function chat(messages: Msg[], extra: Record<string, unknown> = {}, headers: Record<string, string> = { Authorization: `Bearer ${SECRET}` }) {
  return new Request("http://test.local/api/voice/llm/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: "aegis", stream: true, max_tokens: 5000, messages, ...extra }),
  });
}

/** Read an SSE body the way ElevenLabs does: the content deltas joined, plus any tool calls. */
async function readStream(res: Response) {
  const text = await res.text();
  const events = text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => b.slice(6));
  expect(events.at(-1)).toBe("[DONE]");
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e) as { object: string; choices: { delta: { content?: string; tool_calls?: { function: { name: string } }[] }; finish_reason: string | null }[] });
  for (const c of chunks) expect(c.object).toBe("chat.completion.chunk");
  return {
    content: chunks.map((c) => c.choices[0].delta.content ?? "").join(""),
    tools: chunks.flatMap((c) => c.choices[0].delta.tool_calls ?? []).map((t) => t.function.name),
    finish: chunks.at(-1)!.choices[0].finish_reason,
  };
}

beforeEach(async () => {
  swap.driver = undefined;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  vi.stubEnv("VOICE_LLM_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/voice/llm: who may call it", () => {
  it("answers only ElevenLabs, with the shared secret as a Bearer token", async () => {
    const turn = [system(), { role: "user" as const, content: "Hi" }];
    expect((await llm(chat(turn, {}, {}))).status).toBe(401);
    expect((await llm(chat(turn, {}, { Authorization: "Bearer not-the-secret" }))).status).toBe(401);
    expect((await llm(chat(turn, {}, { Authorization: `Bearer ${SECRET}x` }))).status).toBe(401);
    expect((await llm(chat(turn, {}, { "x-aegis-voice-secret": SECRET }))).status).toBe(200);
    expect((await llm(chat(turn))).status).toBe(200);
  });

  it("is closed when no secret is set up", async () => {
    vi.stubEnv("VOICE_LLM_SECRET", "");
    expect((await llm(chat([system(), { role: "user", content: "Hi" }]))).status).toBe(503);
  });

  it("refuses a call id the phone line didn't start, and a request it can't place", async () => {
    const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
    const { callId } = (await res.json()) as { callId: string };
    const asOther = await llm(chat([{ role: "user", content: "Hi" }], { elevenlabs_extra_body: { aegis_call_id: callId } }));
    expect(asOther.status).toBe(404);
    expect((await llm(chat([{ role: "user", content: "Hi" }]))).status).toBe(400);
    expect((await llm(new Request("http://test.local/api/voice/llm", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: "nope" }))).status).toBe(400);
  });
});

describe("POST /api/voice/llm: one call per ElevenLabs conversation", () => {
  it("starts an inbound call for a new conversation and says only the driver's guarded lines", async () => {
    const res = await llm(chat([system(), { role: "assistant", content: inboundGreeting(PHARMACY_NAME) }, { role: "user", content: "Are you open on Sunday?" }]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const out = await readStream(res);
    // The contract's fake driver answers every line with its guarded "One moment.".
    expect(out.content).toBe("One moment.");
    expect(out.finish).toBe("stop");
    const callId = (await runtime.getStore().listRecord()).find((e) => e.callId)?.callId;
    expect((await runtime.getStore().getCall(callId!))?.direction).toBe("inbound");
  });

  it("sends each caller line to the driver once: a dropped answer is replayed, never re-run", async () => {
    const said: string[] = [];
    const real = runtime.getDriver();
    swap.driver = { ...real, callerSays: (id, text) => (said.push(text), real.callerSays(id, text)) };
    const first = [system(), { role: "assistant" as const, content: "Hi." }, { role: "user" as const, content: "Is my refill ready?" }];
    // ElevenLabs drops the first connection before reading the answer, then asks again.
    await (await llm(chat(first))).body?.cancel();
    expect((await readStream(await llm(chat(first)))).content).toBe("One moment.");
    const second = [...first, { role: "assistant" as const, content: "One moment." }, { role: "user" as const, content: "Thanks." }];
    expect((await readStream(await llm(chat(second)))).content).toBe("One moment.");
    expect(said).toEqual(["Is my refill ready?", "Thanks."]);
  });

  it("answers a silence (asked again with nothing new) with the driver's check-in, once", async () => {
    const real = runtime.getDriver();
    const guard = createSpeechGuard({ store: runtime.getStore(), emit });
    swap.driver = {
      ...real,
      async *checkIn(id: string) {
        yield { type: "line", text: (await guard(id, "Are you still there? Take your time.")).speak };
      },
    } as AgentDriver;
    const turn = [system(), { role: "user" as const, content: "Is my refill ready?" }];
    expect((await readStream(await llm(chat(turn)))).content).toBe("One moment.");
    const quiet = [...turn, { role: "assistant" as const, content: "One moment." }];
    expect((await readStream(await llm(chat(quiet)))).content).toBe("Are you still there? Take your time.");
    expect((await readStream(await llm(chat(quiet)))).content).toBe("");
    // They speak again: a normal turn, and the next silence gets a check-in again.
    const back = [...quiet, { role: "assistant" as const, content: "Are you still there? Take your time." }, { role: "user" as const, content: "Yes, sorry." }];
    expect((await readStream(await llm(chat(back)))).content).toBe("One moment.");
    expect((await readStream(await llm(chat([...back, { role: "assistant", content: "One moment." }])))).content).toBe("Are you still there? Take your time.");
  });

  it("keeps two conversations apart", async () => {
    await readStream(await llm(chat([system("conv_a"), { role: "user", content: "Hello" }])));
    await readStream(await llm(chat([system("conv_b"), { role: "user", content: "Hello" }])));
    const ids = new Set((await runtime.getStore().listRecord()).filter((e) => e.callId).map((e) => e.callId));
    expect(ids.size).toBe(2);
  });

  it("answers a non-streaming request with one chat.completion", async () => {
    const res = await llm(chat([system(), { role: "user", content: "Hello" }], { stream: false }));
    const body = (await res.json()) as { object: string; choices: { message: { role: string; content: string }; finish_reason: string }[] };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "One moment." });
  });
});

describe("POST /api/voice/llm: the real driver, its buttons and its speech guard", () => {
  function realDriver(steps: Parameters<typeof scriptedModel>[0]) {
    const store = runtime.getStore();
    const control = runtime.getControl();
    swap.driver = createAgentDriver({
      calls: control,
      press: control.press,
      guardSentence: createSpeechGuard({ store, emit }),
      checkCallerLine: createSafetyCheck({ store, emit }),
      model: scriptedModel(steps),
      pharmacyName: PHARMACY_NAME,
      emit,
    });
  }

  it("never lets an unguarded sentence or an unchecked press reach the phone", async () => {
    realDriver([
      // Before verification: names the drug (S1) and tries a refill (the lock says no).
      { text: ["Your Concerta refill is ready. "], tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["Can I take your name and date of birth?"] },
    ]);
    const out = await readStream(await llm(chat([system(), { role: "assistant", content: inboundGreeting(PHARMACY_NAME) }, { role: "user", content: "Refill my Concerta." }])));
    expect(out.content).not.toMatch(/concerta/i);
    expect(out.content).toContain("Can I take your name and date of birth?");
    const record = await runtime.getStore().listRecord();
    expect(record.some((e) => e.kind === "line_blocked")).toBe(true);
    const refill = record.find((e) => e.button === "request_refill");
    expect(refill?.decision).not.toBe("allowed");
    // The fixed greeting ElevenLabs spoke is on the record too, through the guard.
    expect(record.some((e) => e.kind === "line_spoken" && (e.input as { text?: string }).text === inboundGreeting(PHARMACY_NAME))).toBe(true);
  });

  it("puts the caller's words through the safety check first", async () => {
    realDriver([]);
    const out = await readStream(await llm(chat([system(), { role: "user", content: "I have chest pain and I can't breathe" }])));
    expect(out.content).toMatch(/911/);
  });

  it("hangs up through end_call only after our driver ended the call", async () => {
    const tools = [{ type: "function", function: { name: "end_call", description: "End the call", parameters: { type: "object", properties: {} } } }];
    const real = runtime.getDriver();
    swap.driver = {
      ...real,
      async *callerSays(id, text) {
        if (text !== "Bye.") return yield* real.callerSays(id, text);
        await real.endCall(id);
        yield { type: "line", text: "Goodbye." };
        yield { type: "ended" };
      },
    };
    const first = await readStream(await llm(chat([system(), { role: "user", content: "Hello" }], { tools })));
    expect(first.tools).toEqual([]);
    const history = [system(), { role: "user" as const, content: "Hello" }, { role: "assistant" as const, content: "One moment." }, { role: "user" as const, content: "Bye." }];
    const last = await readStream(await llm(chat(history, { tools })));
    expect(last).toEqual({ content: "Goodbye.", tools: ["end_call"], finish: "tool_calls" });
    // Anything after that only hangs up again; nothing reaches the driver.
    const again = await readStream(await llm(chat([...history, { role: "assistant", content: "Goodbye." }, { role: "user", content: "Wait" }], { tools })));
    expect(again).toEqual({ content: "", tools: ["end_call"], finish: "tool_calls" });
    const callId = (await runtime.getStore().listRecord()).find((e) => e.callId)!.callId!;
    expect(voiceCall(callId)?.ended).toBe(true);
  });
});
