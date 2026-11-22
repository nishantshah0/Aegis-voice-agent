import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { outboundOpener } from "@/lib/agent/lines";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import * as runtime from "./_lib/runtime";
import { twilioSignature } from "./_lib/twilio";
import { resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { POST as outbound } from "./voice/outbound/route";
import { POST as twiml } from "./voice/twiml/route";
import { POST as status } from "./voice/twilio-status/route";

// Trail #70: outbound real calls on a Twilio trial's shared number. We place the call with
// Twilio's REST API; Twilio fetches /api/voice/twiml, which registers the call with ElevenLabs
// (register-call) and hands back its TwiML. Twilio and ElevenLabs are a fetch mock here, and
// every number is a made-up 555 one.

const swap = vi.hoisted(() => ({ driver: undefined as AgentDriver | undefined }));
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  return { ...real, getDriver: () => swap.driver ?? real.getDriver() };
});
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const TOKEN = "twilio-test-token";
const PUBLIC = "https://line.example.test";
const FROM = "+15555550100";
const TO = "+15555550101";
const TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://api.elevenlabs.io/v1/convai/twilio/stream"/></Connect></Response>`;

let fetchMock: ReturnType<typeof vi.fn>;
let twilioReply: () => Response;

function twilioLine() {
  vi.stubEnv("DEMO_CONTROLS", "on");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("TWILIO_PHONE_NUMBER", FROM);
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

/** A request the way Twilio sends it: form fields, signed with the auth token over the public URL. */
function fromTwilio(path: string, fields: Record<string, string>, token = TOKEN) {
  const url = `${PUBLIC}${path}`;
  return new Request(`http://localhost:3070${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(token, url, fields) },
    body: new URLSearchParams(fields),
  });
}

const sent = (host: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(host));

beforeEach(async () => {
  swap.driver = undefined;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  twilioReply = () => new Response(JSON.stringify({ sid: "CA_test", status: "queued" }), { status: 201 });
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/Calls.json")) return twilioReply();
    if (String(url).includes("/Messages.json")) return new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 });
    if (String(url).includes("register-call")) return new Response(TWIML, { status: 200, headers: { "Content-Type": "application/xml" } });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("twilioSignature", () => {
  it("is Twilio's scheme: HMAC-SHA1 over the URL plus each field, sorted by name, in base64", () => {
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
    expect(twilioSignature("12345", url, params)).toBe(createHmac("sha1", "12345").update(url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("")).digest("base64"));
    expect(twilioSignature("12345", url, { ...params })).not.toBe(twilioSignature("12345", url, { ...params, Digits: "1235" }));
  });
});

describe("POST /api/voice/outbound on a Twilio trial number", () => {
  it("places the call through Twilio's REST API, after rule 7, with our call id in the TwiML URL", async () => {
    twilioLine();
    realDriver();
    const res = await outbound();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TO);
    expect(text).not.toContain(FROM);
    const { callId } = JSON.parse(text) as { callId: string };

    const [[url, init]] = sent("/Calls.json");
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Calls.json");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("To")).toBe(TO);
    expect(form.get("From")).toBe(FROM);
    expect(form.get("Url")).toMatch(new RegExp(`^${PUBLIC}/api/voice/twiml\\?call=${callId}&t=[A-Za-z0-9_-]{32}$`));
    expect(form.get("StatusCallback")).toBe(`${PUBLIC}/api/voice/twilio-status?call=${callId}`);
    // A One Console trial refuses these with "trial accounts have limited parameter access" (code 0).
    // Twilio's defaults are what we want anyway: POST, and the status callback on completion.
    expect([...form.keys()].sort()).toEqual(["From", "StatusCallback", "To", "Url"]);
    expect((await runtime.getStore().getCall(callId))?.targetPatientId).toBe(IDS.sam);
  });

  it("gives Twilio's error code (never its message) and ends our side when Twilio refuses", async () => {
    twilioLine();
    twilioReply = () => new Response(JSON.stringify({ code: 21219, message: `The number ${TO} is unverified.`, status: 400 }), { status: 400 });
    const res = await outbound();
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("21219");
    expect(body).toContain("The number <number> is unverified.");
    expect(body).not.toContain(TO);
    const callId = (await runtime.getStore().listRecord()).find((e) => e.callId)!.callId!;
    expect((await runtime.getStore().getCall(callId))?.state).toBe("ended");
  });

  it("lists what's missing for the Twilio route by name", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    const res = await outbound();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/TWILIO_ACCOUNT_SID.*TEST_PATIENT_PHONE/);
  });
});

describe("POST /api/voice/twiml (Twilio asks what to do when the call connects)", () => {
  async function placed() {
    twilioLine();
    realDriver();
    const callId = ((await (await outbound()).json()) as { callId: string }).callId;
    const url = new URLSearchParams(sent("/Calls.json")[0][1].body as URLSearchParams).get("Url")!;
    return { callId, path: url.slice(PUBLIC.length) };
  }

  it("registers the call with ElevenLabs, with our id and the guarded opener, and returns its TwiML", async () => {
    const { callId, path } = await placed();
    const res = await twiml(fromTwilio(path, { CallSid: "CA_test", From: FROM, To: TO, CallStatus: "in-progress" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("xml");
    expect(await res.text()).toBe(TWIML);

    const [[url, init]] = sent("register-call");
    expect(url).toBe("https://api.elevenlabs.io/v1/convai/twilio/register-call");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-eleven-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ agent_id: "agent_test", from_number: FROM, to_number: TO, direction: "outbound" });
    expect(body.conversation_initiation_client_data.custom_llm_extra_body).toEqual({ aegis_call_id: callId });
    expect(body.conversation_initiation_client_data.conversation_config_override.agent.first_message).toBe(outboundOpener(PHARMACY_NAME, "Sam Rivera"));
  });

  it("needs the call's own URL token or Twilio's signature, and a token works only for its call", async () => {
    const { callId, path } = await placed();
    const fields = { CallSid: "CA_test", From: FROM, To: TO };
    const post = (p: string, headers: Record<string, string> = {}) =>
      twiml(new Request(`http://localhost:3070${p}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) }));
    // A One Console trial fetches the Url with a signature our token doesn't match: the URL token is enough.
    expect((await post(path, { "X-Twilio-Signature": "not-ours" })).status).toBe(200);
    await runtime.resetRuntimeForTests();
    resetVoiceLineForTests();
    fetchMock.mockClear();
    const again = await placed();
    expect((await post(`/api/voice/twiml?call=${again.callId}`)).status).toBe(403);
    expect((await post(`/api/voice/twiml?call=${again.callId}&t=${"x".repeat(32)}`)).status).toBe(403);
    // A token for one call, moved to another call id.
    const token = new URL(`http://x${again.path}`).searchParams.get("t");
    expect((await post(`/api/voice/twiml?call=c_9999&t=${token}`)).status).toBe(403);
    // Twilio's own signature still works without the token.
    expect((await twiml(fromTwilio(`/api/voice/twiml?call=${again.callId}`, fields))).status).toBe(200);
    expect((await twiml(fromTwilio(`/api/voice/twiml?call=${again.callId}`, fields, "wrong-token"))).status).toBe(403);
    expect(callId).toBeTruthy();
  });

  it("hangs up (never a spoken <Say>) for a call the phone line doesn't know", async () => {
    twilioLine();
    const res = await twiml(fromTwilio(`/api/voice/twiml?call=c_9999`, { CallSid: "CA_x" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Say");
  });
});

describe("POST /api/voice/twilio-status (Twilio says the call is over)", () => {
  it("ends our side of the call when Twilio reports it finished", async () => {
    twilioLine();
    realDriver();
    const { callId } = (await (await outbound()).json()) as { callId: string };
    const res = await status(fromTwilio(`/api/voice/twilio-status?call=${callId}`, { CallSid: "CA_test", CallStatus: "completed" }));
    expect(res.status).toBeLessThan(300);
    expect(voiceCall(callId)?.ended).toBe(true);
    expect((await runtime.getStore().getCall(callId))?.state).toBe("ended");
  });

  it("ignores progress updates and unsigned requests", async () => {
    twilioLine();
    const { callId } = (await (await outbound()).json()) as { callId: string };
    await status(fromTwilio(`/api/voice/twilio-status?call=${callId}`, { CallSid: "CA_test", CallStatus: "ringing" }));
    expect(voiceCall(callId)?.ended).toBe(false);
    const forged = await status(fromTwilio(`/api/voice/twilio-status?call=${callId}`, { CallStatus: "completed" }, "wrong-token"));
    expect(forged.status).toBe(403);
    expect(voiceCall(callId)?.ended).toBe(false);
  });
});
