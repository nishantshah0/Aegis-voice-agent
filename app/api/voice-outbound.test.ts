import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver, Approver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { outboundOpener } from "@/lib/agent/lines";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import * as runtime from "./_lib/runtime";
import { CODE_ON_FILE, resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { POST as outbound } from "./voice/outbound/route";
import { POST as llm } from "./voice/llm/[[...path]]/route";

// Trail #70: "Call on a real phone". ElevenLabs and Twilio are faked with a fetch mock; the
// numbers are made-up 555 numbers, like every number in this repo.

const swap = vi.hoisted(() => ({ driver: undefined as AgentDriver | undefined, approver: null as Approver | null }));
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  return { ...real, getDriver: () => swap.driver ?? real.getDriver() };
});
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => swap.approver,
}));

const TEST_PHONE = "+15555550101";
const SECRET = "test-voice-secret-0123456789";
let fetchMock: ReturnType<typeof vi.fn>;

function phoneLine() {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test");
  vi.stubEnv("ELEVENLABS_PHONE_NUMBER_ID", "phnum_test");
  vi.stubEnv("TEST_PATIENT_PHONE", TEST_PHONE);
}

function realDriver() {
  const store = runtime.getStore();
  const control = runtime.getControl();
  swap.driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model: scriptedModel([{ text: ["Thanks. What's the code and your date of birth?"] }]),
    pharmacyName: PHARMACY_NAME,
    emit,
  });
}

const sentTo = (host: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(host));

beforeEach(async () => {
  swap.driver = undefined;
  swap.approver = null;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  vi.stubEnv("VOICE_LLM_SECRET", SECRET);
  fetchMock = vi.fn(async (url: string) =>
    String(url).includes("twilio.com")
      ? new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 })
      : new Response(JSON.stringify({ success: true, message: "ok", conversation_id: "conv_out_1", callSid: "CA_test" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/voice/outbound", () => {
  it("is for signed-in pharmacists, or a demo laptop with DEMO_CONTROLS=on", async () => {
    phoneLine();
    expect((await outbound()).status).toBe(401);
    swap.approver = { id: "auth0|r", name: "Reviewer", role: "reviewer" };
    expect((await outbound()).status).toBe(403);
    swap.approver = { id: "auth0|p", name: "Pharmacist", role: "pharmacist" };
    expect((await outbound()).status).toBe(200);
  });

  it("says which .env names are missing, never their values", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    const res = await outbound();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("TEST_PATIENT_PHONE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rings through rule 7, says the guarded opener first, and keeps the number out of the reply", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    phoneLine();
    realDriver();
    const res = await outbound();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TEST_PHONE);
    const { callId, conversationId } = JSON.parse(text) as { callId: string; conversationId: string };
    expect(conversationId).toBe("conv_out_1");

    const [[url, init]] = sentTo("elevenlabs.io");
    expect(url).toBe("https://api.elevenlabs.io/v1/convai/twilio/outbound-call");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ agent_id: "agent_test", agent_phone_number_id: "phnum_test", to_number: TEST_PHONE });
    expect(body.conversation_initiation_client_data.custom_llm_extra_body).toEqual({ aegis_call_id: callId });
    // No Twilio texting here, so the code went to the paired /phone page, and the agent says so.
    expect(body.conversation_initiation_client_data.conversation_config_override.agent.first_message).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);

    const record = await runtime.getStore().listRecord(callId);
    expect(record.some((e) => (e.input as { check?: string })?.check === "call_start")).toBe(true);
    expect(record.some((e) => e.kind === "line_spoken" && (e.input as { text?: string }).text === outboundOpener(PHARMACY_NAME, "Sam Rivera"))).toBe(true);
    expect(record.some((e) => e.button === "send_code")).toBe(true);

    // Sam answers; the endpoint knows the call by its aegis_call_id.
    const turn = await llm(
      new Request("http://test.local/api/voice/llm/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stream: false, messages: [{ role: "assistant", content: "opener" }, { role: "user", content: "Yes, this is Sam." }], elevenlabs_extra_body: { aegis_call_id: callId } }),
      }),
    );
    const reply = (await turn.json()) as { choices: { message: { content: string } }[] };
    expect(reply.choices[0].message.content).toBe("Thanks. What's the code and your date of birth?");
    expect(voiceCall(callId)?.conversationId).toBe("conv_out_1");
  });

  it("texts Sam's code to the test phone when Twilio is set up", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    phoneLine();
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio-test-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
    realDriver();
    const { callId } = (await (await outbound()).json()) as { callId: string };
    const [[url, init]] = sentTo("twilio.com");
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("To")).toBe(TEST_PHONE);
    expect(form.get("Body")).toBe(`Your pharmacy verification code is ${await runtime.getControl().codeFor(callId)}.`);
  });

  it("won't ring Sam twice while a call is open, and ends our side if ElevenLabs can't place it", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    phoneLine();
    expect((await outbound()).status).toBe(200);
    expect((await outbound()).status).toBe(409);

    await runtime.resetRuntimeForTests();
    resetVoiceLineForTests();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: [{ msg: `bad number ${TEST_PHONE}` }] }), { status: 422 }));
    const failed = await outbound();
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain(TEST_PHONE);
    const callId = (await runtime.getStore().listRecord()).find((e) => e.callId)!.callId!;
    expect((await runtime.getStore().getCall(callId))?.state).toBe("ended");
  });

  it("only rings Sam's own number: the request body can't pick another patient", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    phoneLine();
    await outbound();
    const callId = (await runtime.getStore().listRecord()).find((e) => e.callId)!.callId!;
    expect((await runtime.getStore().getCall(callId))?.targetPatientId).toBe(IDS.sam);
  });
});
