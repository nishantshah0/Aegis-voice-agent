import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { outboundOpener } from "@/lib/agent/lines";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import { DEVICE_COOKIE, claimPairing, clearDevicesForTests, createPairing } from "./_lib/devices";
import * as runtime from "./_lib/runtime";
import { CODE_ON_FILE, resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { POST as outbound } from "./voice/outbound/route";
import { GET as deviceCode } from "./phone/code/route";
import { twilioSignature } from "./_lib/twilio";
import { POST as status } from "./voice/twilio-status/route";

// Trail #70: a Twilio trial's shared number can't send texts, so on a real phone call the
// verification code goes to the patient's paired /phone page instead, the demo's "phone on
// file". Text first when it works; never anywhere else; never said on the call.

const swap = vi.hoisted(() => ({ driver: undefined as AgentDriver | undefined }));
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  return { ...real, getDriver: () => swap.driver ?? real.getDriver() };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const PUBLIC = "https://line.example.test";
const TO = "+15555550101";
let smsWorks = false;
let fetchMock: ReturnType<typeof vi.fn>;

function twilioLine() {
  vi.stubEnv("DEMO_CONTROLS", "on");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio-test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
  vi.stubEnv("TEST_PATIENT_PHONE", TO);
  vi.stubEnv("VOICE_LLM_URL", `${PUBLIC}/api/voice/llm`);
}

function realDriver() {
  const store = runtime.getStore();
  const control = runtime.getControl();
  swap.driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model: scriptedModel([]),
    pharmacyName: PHARMACY_NAME,
    emit,
  });
}

function pairedTo(patientId: string): string {
  return claimPairing(createPairing(patientId).code)!;
}

const fromDevice = (device?: string) => new Request("http://localhost:3070/api/phone/code", { headers: device ? { cookie: `${DEVICE_COOKIE}=${device}` } : {} });
const texts = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/Messages.json"));

beforeEach(async () => {
  swap.driver = undefined;
  smsWorks = false;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  clearDevicesForTests();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/Messages.json")) {
      return smsWorks ? new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 }) : new Response(JSON.stringify({ code: 21606, message: "The From number is not a valid message-capable number." }), { status: 400 });
    }
    if (String(url).includes("/Calls.json")) return new Response(JSON.stringify({ sid: "CA_test" }), { status: 201 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the verification code on a real phone call", () => {
  it("goes to the paired /phone page when the number can't text, and the agent says so through the guard", async () => {
    twilioLine();
    realDriver();
    const sam = pairedTo(IDS.sam);
    const { callId } = (await (await outbound()).json()) as { callId: string };

    expect(texts()).toHaveLength(1);
    const call = voiceCall(callId)!;
    expect(call.firstMessage).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);
    const record = await runtime.getStore().listRecord(callId);
    expect(record.some((e) => e.kind === "line_spoken" && (e.input as { text?: string }).text === CODE_ON_FILE)).toBe(true);

    const res = await deviceCode(fromDevice(sam));
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    expect(code).toBe(await runtime.getControl().codeFor(callId));
    // Never said on the call.
    expect(call.firstMessage).not.toContain(code);
  });

  it("is only for the patient's own paired device", async () => {
    twilioLine();
    realDriver();
    const jordan = pairedTo(IDS.p2);
    await outbound();
    expect((await deviceCode(fromDevice())).status).toBe(401);
    expect((await deviceCode(fromDevice("not-a-device"))).status).toBe(401);
    expect((await deviceCode(fromDevice(jordan))).status).toBe(204);
  });

  it("texts the real phone first when it can, and then nothing shows on the page", async () => {
    twilioLine();
    realDriver();
    smsWorks = true;
    const sam = pairedTo(IDS.sam);
    const { callId } = (await (await outbound()).json()) as { callId: string };
    expect(texts()).toHaveLength(1);
    expect(voiceCall(callId)!.firstMessage).toBe(outboundOpener(PHARMACY_NAME, "Sam Rivera"));
    expect((await deviceCode(fromDevice(sam))).status).toBe(204);
  });

  it("is gone once the call is over", async () => {
    twilioLine();
    realDriver();
    const sam = pairedTo(IDS.sam);
    const { callId } = (await (await outbound()).json()) as { callId: string };
    expect((await deviceCode(fromDevice(sam))).status).toBe(200);
    const path = `/api/voice/twilio-status?call=${callId}`;
    const fields = { CallSid: "CA_test", CallStatus: "completed" };
    await status(
      new Request(`http://localhost:3070${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature("twilio-test-token", `${PUBLIC}${path}`, fields) },
        body: new URLSearchParams(fields),
      }),
    );
    expect((await deviceCode(fromDevice(sam))).status).toBe(204);
  });
});
