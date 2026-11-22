import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@/lib/contract";
import { createAgentDriver } from "@/lib/agent";
import { outboundOpener } from "@/lib/agent/lines";
import type { AgentModel } from "@/lib/agent/model";
import { scriptedModel, type ScriptStep } from "@/lib/agent/testing/scripted-model";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import { resetSpeechBudgetForTests } from "./_lib/phone";
import * as runtime from "./_lib/runtime";
import { CODE_ON_FILE, resetVoiceLineForTests, voiceCall } from "./_lib/voice-line";
import { FILLER_LINE, resetVoiceAudioForTests } from "./_lib/voice-gather";
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
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
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

function realDriver(steps: ScriptStep[], model: AgentModel = scriptedModel(steps)) {
  const store = runtime.getStore();
  const control = runtime.getControl();
  swap.driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model,
    pharmacyName: PHARMACY_NAME,
    emit,
  });
}

/** Place the call; return its id and the TwiML URL Twilio was given (with its token). */
async function placed(steps: ScriptStep[] = [], model?: AgentModel) {
  twilioLine();
  realDriver(steps, model);
  const { callId } = (await (await outbound()).json()) as { callId: string };
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/Calls.json"));
  const url = new URL(new URLSearchParams(calls[0][1].body as URLSearchParams).get("Url")!);
  return { callId, token: url.searchParams.get("t")! };
}

const post = (path: string, fields: Record<string, string>) =>
  new Request(`http://localhost:3070${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

/** The TwiML's verbs, in order, with the URLs and text they carry. */
function verbs(xml: string) {
  return [...xml.matchAll(/<(Play|Gather|Redirect|Say|Hangup)\b([^>]*?)(?:\/>|>([^<]*)<\/\1>|>)/g)].map(([, verb, attrs, body]) => ({
    verb,
    action: /action="([^"]*)"/.exec(attrs)?.[1]?.replaceAll("&amp;", "&"),
    text: body?.replaceAll("&amp;", "&"),
  }));
}

/** Every text ElevenLabs has been asked to voice so far, in order (each line once: audio is cached). */
function voiced(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/text-to-speech/"))
    .map(([, init]) => (JSON.parse(init.body as string) as { text: string }).text);
}

/** Each Play is a real clip of this call; the words are the lines voiced since `since`, joined. */
async function playedText(xmlVerbs: ReturnType<typeof verbs>, callId: string, since = 0) {
  const plays = xmlVerbs.filter((v) => v.verb === "Play");
  if (!plays.length) return undefined;
  for (const play of plays) {
    const res = await clip(new Request(play.text!.replace(PUBLIC, "http://localhost:3070")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO);
  }
  expect(callId).toBeTruthy();
  return voiced().slice(since).join(" ");
}

/** The reply's shape: one Gather wrapping only Play (or Say) lines, then the Redirect for a silence. */
function expectListeningReply(v: ReturnType<typeof verbs>, spoken: "Play" | "Say" = "Play") {
  expect(v[0].verb).toBe("Gather");
  expect(v.at(-1)!.verb).toBe("Redirect");
  expect(v.slice(1, -1).length).toBeGreaterThan(0);
  expect(v.slice(1, -1).every((x) => x.verb === spoken)).toBe(true);
}

beforeEach(async () => {
  swap.driver = undefined;
  ttsWorks = true;
  resetBusForTests();
  await runtime.resetRuntimeForTests();
  resetVoiceLineForTests();
  resetSpeechBudgetForTests();
  resetVoiceAudioForTests();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/Verifications")) return new Response(JSON.stringify({ status: "pending" }), { status: 201 });
    if (String(url).includes("/VerificationCheck")) {
      const code = new URLSearchParams(init?.body as URLSearchParams).get("Code");
      return new Response(JSON.stringify({ status: code === "123456" ? "approved" : "pending" }), { status: 200 });
    }
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
    expectListeningReply(v);
    expect(await playedText(v, callId)).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);
    expect(v[0].action).toBe(`${PUBLIC}/api/voice/turn?call=${callId}&t=${token}`);
    // The reply plays inside the Gather, so the caller can talk over it; a 1-second pause ends their turn.
    expect(xml).toMatch(/<Gather[^>]*input="speech"[^>]*speechTimeout="1"[^>]*speechModel="phone_call"[^>]*><Play>/);
  });

  it("puts what Twilio heard through the driver, and plays only the guarded lines", async () => {
    // The model names the drug before verification (S1) and tries a refill (the lock says no).
    const { callId, token } = await placed([
      { text: ["Your Concerta refill is ready. "], tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["What's the code and your date of birth?"] },
    ]);
    const since = voiced().length;
    const res = await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { CallSid: "CA_test", SpeechResult: "Yes, this is Sam. Refill my Concerta." }));
    const v = verbs(await res.text());
    expectListeningReply(v);
    const said = await playedText(v, callId, since);
    expect(said).not.toMatch(/concerta/i);
    expect(said).toContain("What's the code and your date of birth?");
    const record = await runtime.getStore().listRecord(callId);
    expect(record.some((e) => e.kind === "line_blocked")).toBe(true);
    expect(record.find((e) => e.button === "request_refill")?.decision).not.toBe("allowed");
  });

  it("checks the caller's words for an emergency before the model sees them", async () => {
    const { callId, token } = await placed([]);
    const since = voiced().length;
    const v = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "I have chest pain and I can't breathe" }))).text());
    expect(await playedText(v, callId, since)).toMatch(/911/);
  });

  it("checks in once after a silence, and hangs up after a second one", async () => {
    const { callId, token } = await placed([{ text: ["Thanks. What's the code?"] }]);
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }));
    const quiet = `/api/voice/turn?call=${callId}&t=${token}&quiet=1`;
    const since = voiced().length;
    const first = verbs(await (await turn(post(quiet, {}))).text());
    // The driver's own check-in, whichever wording it picks (agent upgrade, Trail #75), as the guard passed it.
    const checkIn = await playedText(first, callId, since);
    expect(checkIn).toBeTruthy();
    const spoken = (await runtime.getStore().listRecord(callId)).filter((e) => e.kind === "line_spoken").map((e) => (e.input as { text?: string }).text);
    expect(spoken.at(-1)).toBe(checkIn);
    expectListeningReply(first);
    const second = verbs(await (await turn(post(quiet, {}))).text());
    expect(second.map((x) => x.verb)).toEqual(["Hangup"]);
    expect(voiceCall(callId)?.ended).toBe(true);
    expect((await runtime.getStore().getCall(callId))?.state).toBe("ended");
  });

  it("says the guarded words with Twilio's voice if the ElevenLabs voice fails", async () => {
    const { callId, token } = await placed();
    ttsWorks = false;
    const v = verbs(await (await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, {}))).text());
    expectListeningReply(v, "Say");
    expect(v[1].text).toBe(`${outboundOpener(PHARMACY_NAME, "Sam Rivera")} ${CODE_ON_FILE}`);
  });

  it("only answers this call's own token, and a clip is only this call's guarded lines", async () => {
    const { callId, token } = await placed();
    expect((await turn(post(`/api/voice/turn?call=${callId}`, { SpeechResult: "hi" }))).status).toBe(403);
    expect((await turn(post(`/api/voice/turn?call=${callId}&t=${"x".repeat(32)}`, { SpeechResult: "hi" }))).status).toBe(403);
    expect((await clip(new Request(`http://localhost:3070/api/voice/clip?call=${callId}&t=nope&n=0`))).status).toBe(403);
    // No clip was made for turn 5; nothing is voiced from the request itself.
    expect((await clip(new Request(`http://localhost:3070/api/voice/clip?call=${callId}&t=${token}&n=5&text=anything`))).status).toBe(404);
  });

  it("voices a repeated line once: the second time it plays from the cache", async () => {
    const { callId, token } = await placed([{ text: ["Thanks. What's the code?"] }, { text: ["Thanks. What's the code?"] }]);
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }));
    const before = voiced().length;
    const v = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Sorry?" }))).text());
    expectListeningReply(v);
    expect(voiced().length).toBe(before);
  });

  it("says no filler line unless VOICE_FILLER_MS is set, however slow the turn", async () => {
    const slow = scriptedModel([{ text: ["Thanks. What's the code?"] }]);
    const { callId, token } = await placed([], {
      ...slow,
      async *turn(request) {
        await new Promise((r) => setTimeout(r, 1400));
        yield* slow.turn(request);
      },
    });
    const v = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }))).text());
    expectListeningReply(v);
    const spoken = (await runtime.getStore().listRecord(callId)).filter((e) => e.kind === "line_spoken").map((e) => (e.input as { text?: string }).text);
    expect(spoken).not.toContain(FILLER_LINE);
  });

  it("says the guarded filler line on a slow turn, then plays the answer on the resumed request", async () => {
    vi.stubEnv("VOICE_FILLER_MS", "20");
    const slow = scriptedModel([{ text: ["Thanks. What's the code?"] }]);
    const { callId, token } = await placed([], {
      ...slow,
      async *turn(request) {
        await new Promise((r) => setTimeout(r, 150));
        yield* slow.turn(request);
      },
    });
    const store = runtime.getStore();
    const since = voiced().length;
    const first = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }))).text());
    expect(first.map((x) => x.verb)).toEqual(["Play", "Redirect"]);
    expect(first[1].text).toBe(`${PUBLIC}/api/voice/turn?call=${callId}&t=${token}&cont=1`);
    expect(await playedText(first, callId, since)).toBe(FILLER_LINE);
    const spoken = (await store.listRecord(callId)).filter((e) => e.kind === "line_spoken").map((e) => (e.input as { text?: string }).text);
    expect(spoken).toContain(FILLER_LINE);
    // The resumed request hears nothing new: it plays the same turn's answer, and isn't a silence.
    const after = voiced().length;
    const answer = verbs(await (await turn(post(`/api/voice/turn?call=${callId}&t=${token}&cont=1`, {}))).text());
    expectListeningReply(answer);
    expect(await playedText(answer, callId, after)).toContain("What's the code?");
    expect(voiceCall(callId)?.quiet).toBe(0);
  });

  it("texts the code through Twilio Verify on a trial, and gives the agent the lock's own code only when Verify approves", async () => {
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VA_test");
    const model = scriptedModel([{ text: ["Thanks."] }, { text: ["Thanks."] }, { text: ["Thanks."] }]);
    const { callId, token } = await placed([], model);
    const control = runtime.getControl();
    await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, {}));
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "Hello?" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/Services/VA_test/Verifications"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/Messages.json"))).toBe(false);
    const ours = await control.codeFor(callId);
    expect(ours).toBeTruthy();
    // A wrong code reaches the agent (and so the lock) exactly as said.
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "It's 9 9 9 9 9 9." }));
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("9 9 9 9 9 9");
    // The code Verify texted, once approved, reaches the agent as the lock's own code.
    await turn(post(`/api/voice/turn?call=${callId}&t=${token}`, { SpeechResult: "It's 1 2 3 4 5 6." }));
    const last = JSON.stringify(model.requests.at(-1)!.messages);
    expect(last).toContain(ours!);
    expect(last).not.toContain("1 2 3 4 5 6");
  });

  it("keeps the old ElevenLabs stream behind VOICE_TWILIO_STREAM=1", async () => {
    const { callId, token } = await placed();
    vi.stubEnv("VOICE_TWILIO_STREAM", "1");
    expect(await (await twiml(post(`/api/voice/twiml?call=${callId}&t=${token}`, {}))).text()).toContain("<Stream");
  });
});
