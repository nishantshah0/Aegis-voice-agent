import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { STILL_THERE, outboundOpener } from "@/lib/agent/lines";
import { scriptedModel, type ScriptStep } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import { resetSpeechBudgetForTests } from "./_lib/phone";
import * as runtime from "./_lib/runtime";
import { CODE_ON_FILE, resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { POST as outbound } from "./voice/outbound/route";
import { POST as twiml } from "./voice/twiml/route";
import { POST as turn } from "./voice/turn/route";
import { GET as clip } from "./voice/clip/route";

// Trail #70: a Twilio trial won't run <Connect><Stream>, so the trial-safe phone line is a turn
// loop Twilio does run: <Gather input="speech"> hears the caller (Twilio's speech to text), our
// driver answers through the same takeTurn (safety check, 12 buttons, guardSentence), and
// <Play> speaks the guarded lines in the ElevenLabs voice. Twilio and ElevenLabs are a fetch
// mock; every number is a made-up 555 one.

const swap = vi.hoisted(() => ({ driver: undefined as AgentDriver | undefined }));
vi.mock("./_lib/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./_lib/runtime")>();
  return { ...real, getDriver: () => swap.driver ?? real.getDriver() };
});
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const PUBLIC = "https://line.example.test";
const AUDIO = new Uint8Array([7, 7, 7]);
let fetchMock: ReturnType<typeof vi.fn>;
let ttsWorks = true;

function twilioLine() {
  vi.stubEnv("DEMO_CONTROLS", "on");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio-test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
  vi.stubEnv("TEST_PATIENT_PHONE", "+15555550101");
  vi.stubEnv("VOICE_LLM_URL", `${PUBLIC}/api/voice/llm`);
}

function realDriver(steps: ScriptStep[]) {
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

/** Place the call; return its id and the TwiML URL Twilio was given (with its token). */
async function placed(steps: ScriptStep[] = []) {
  twilioLine();
  realDriver(steps);
  const { callId } = (await (await outbound()).json()) as { callId: string };
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/Calls.json"));
  const url = new URL(new URLSearchParams(calls[0][1].body as URLSearchParams).get("Url")!);
  return { callId, token: url.searchParams.get("t")! };
}

const post = (path: string, fields: Record<string, string>) =>
  new Request(`http://localhost:3070${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

/** The TwiML's verbs, in order, with the URLs and text they carry. */
function verbs(xml: string) {
  return [...xml.matchAll(/<(Play|Gather|Redirect|Say|Hangup)\b([^>]*?)(?:\/>|>([^<]*)<\/\1>)/g)].map(([, verb, attrs, body]) => ({
    verb,
    action: /action="([^"]*)"/.exec(attrs)?.[1]?.replaceAll("&amp;", "&"),
    text: body?.replaceAll("&amp;", "&"),
  }));
}

async function playedText(xmlVerbs: ReturnType<typeof verbs>, callId: string) {
  const play = xmlVerbs.find((v) => v.verb === "Play");
  if (!play?.text) return undefined;
  const res = await clip(new Request(play.text.replace(PUBLIC, "http://localhost:3070")));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO);
  // What was voiced: the text the last ElevenLabs request carried.
  const tts = fetchMock.mock.calls.filter(([url]) => String(url).includes("/text-to-speech/")).at(-1)!;
  expect(callId).toBeTruthy();
  return (JSON.parse(tts[1].body as string) as { text: string }).text;
}

beforeEach(async () => {
  swap.driver = undefined;
  ttsWorks = true;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  resetSpeechBudgetForTests();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/Calls.json")) return new Response(JSON.stringify({ sid: "CA_test" }), { status: 201 });
    if (String(url).includes("/Messages.json")) return new Response(JSON.stringify({ code: 21606, message: "not message-capable" }), { status: 400 });
    if (String(url).includes("/text-to-speech/")) return ttsWorks ? new Response(AUDIO, { status: 200, headers: { "Content-Type": "audio/mpeg" } }) : new Response("{}", { status: 500 });
    if (String(url).includes("register-call")) return new Response("<Response><Connect><Stream url=\"wss://x\"/></Connect></Response>", { status: 200 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the trial-safe turn loop: Gather, our driver, Play", () => {
  it("answers the call with the guarded opener in the ElevenLabs voice, then listens", async () => {
    const { callId, token } = await placed();
    const res = await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, { CallSid: "CA_test", CallStatus: "in-progress" }));
    expect(res.headers.get("content-type")).toContain("xml");
    const xml = await res.text();
    expect(xml).not.toContain("<Stream");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("register-call"))).toBe(false);
    const v = verbs(xml);
    expect(v.map((x) => x.verb)).toEqual(["Play", "Gather", "Redirect"]);
    expect(await playedText(v, callId)).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);
    expect(v[1].action).toBe(`${PUBLIC}/api/voice/turn?call=${callId}&t=${token}`);
    expect(xml).toMatch(/<Gather[^>]*input="speech"/);
  });

  it("puts what Twilio heard through the driver, and plays only the guarded lines", async () => {
    // The model names the drug before verification (S1) and tries a refill (the lock says no).
    const { callId, token } = await placed([
      { text: ["Your Concerta refill is ready. "], tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["What's the code and your date of birth?"] },
    ]);
    const res = await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { CallSid: "CA_test", SpeechResult: "Yes, this is Sam. Refill my Concerta." }));
    const v = verbs(await res.text());
    expect(v.map((x) => x.verb)).toEqual(["Play", "Gather", "Redirect"]);
    const said = await playedText(v, callId);
    expect(said).not.toMatch(/concerta/i);
    expect(said).toContain("What's the code and your date of birth?");
    const record = await runtime.getStore().listRecord(callId);
    expect(record.some((e) => e.kind === "line_blocked")).toBe(true);
    expect(record.find((e) => e.button === "request_refill")?.decision).not.toBe("allowed");
  });

  it("checks the caller's words for an emergency before the model sees them", async () => {
    const { callId, token } = await placed([]);
    const v = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "I have chest pain and I can't breathe" }))).text());
    expect(await playedText(v, callId)).toMatch(/911/);
  });

  it("checks in once after a silence, and hangs up after a second one", async () => {
    const { callId, token } = await placed([{ text: ["Thanks. What's the code?"] }]);
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }));
    const quiet = `/api/voice/turn?call=${callId}&t=${token}&quiet=1`;
    const first = verbs(await (await turn(post(quiet, {}))).text());
    expect(await playedText(first, callId)).toBe(STILL_THERE);
    expect(first.map((x) => x.verb)).toEqual(["Play", "Gather", "Redirect"]);
    const second = verbs(await (await turn(post(quiet, {}))).text());
    expect(second.map((x) => x.verb)).toEqual(["Hangup"]);
    expect(voiceCall(callId)?.ended).toBe(true);
    expect((await runtime.getStore().getCall(callId))?.state).toBe("ended");
  });

  it("says the guarded words with Twilio's voice if the ElevenLabs voice fails", async () => {
    const { callId, token } = await placed();
    ttsWorks = false;
    const v = verbs(await (await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, {}))).text());
    expect(v.map((x) => x.verb)).toEqual(["Say", "Gather", "Redirect"]);
    expect(v[0].text).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);
  });

  it("only answers this call's own token, and a clip is only this call's guarded lines", async () => {
    const { callId, token } = await placed();
    expect((await turn(post(`/api/voice/turn?call=${callId}`, { SpeechResult: "hi" }))).status).toBe(403);
    expect((await turn(post(`/api/voice/turn?call=${callId}&t=${"x".repeat(32)}`, { SpeechResult: "hi" }))).status).toBe(403);
    expect((await clip(new Request(`http://localhost:3070/api/voice/clip?call=${callId}&t=nope&n=0`))).status).toBe(403);
    // No clip was made for turn 5; nothing is voiced from the request itself.
    expect((await clip(new Request(`http://localhost:3070/api/voice/clip?call=${callId}&t=${token}&n=5&text=anything`))).status).toBe(404);
  });

  it("keeps the old ElevenLabs stream behind VOICE_TWILIO_STREAM=1", async () => {
    const { callId, token } = await placed();
    vi.stubEnv("VOICE_TWILIO_STREAM", "1");
    expect(await (await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, {}))).text()).toContain("<Stream");
  });
});
