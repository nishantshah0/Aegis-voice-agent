import { createHash, timingSafeEqual } from "node:crypto";
import type { CallId, Direction } from "@/lib/contract";
import { forCaller } from "@/lib/events/audience";
import { IDS } from "@/lib/seed";
import { fail } from "./http";
import { answerCall, checkInCall, issuePhoneToken, type JoinableDriver } from "./phone";
import { getControl, getDriver, getStore } from "./runtime";
import { sendSms, smsConfigured } from "./sms";

// The real phone line (Trail #70). ElevenLabs Agents answers the phone (Twilio number, speech
// to text, text to speech) and asks OUR server what to say, as an OpenAI-compatible custom LLM.
// This module is that brain's state. It never writes a word itself:
//   * each request is mapped to one of our calls (one the voice line started itself);
//   * the newest caller words go to getDriver().callerSays, the same turn as /api/call/:id/say,
//     so checkCallerLine, the 12 buttons (control.press) and guardSentence all apply;
//   * the reply is only the driver's "line" events, which come out of guardSentence.
// ElevenLabs' own model never runs, and its tools are never used except end_call, which we send
// only after our driver has ended the call.

/** Same limit as /api/call/:id/say. */
export const VOICE_MAX_LINE = 2000;
/** A phone call with no request for this long has hung up (ElevenLabs ends silent calls sooner). */
export const VOICE_IDLE_MS = 5 * 60 * 1000;
/** How long the stream waits for the next guarded line before sending a keep-alive. */
const KEEP_ALIVE_MS = 2000;

type Turn = {
  lines: string[];
  done: boolean;
  /** The driver ended the call during this turn (or it had ended already). */
  ended: boolean;
  /** A response streamed every line of this turn to ElevenLabs. */
  delivered: boolean;
  wake: Set<() => void>;
};

export type VoiceCall = {
  callId: CallId;
  direction: Direction;
  conversationId?: string;
  opened: boolean;
  /** How many of the caller's messages (in ElevenLabs' history) have gone to the driver. */
  handled: number;
  /** Turns by the caller-message count that started them, so a repeated request replays. */
  turns: Map<number, Turn>;
  /** The driver runs one turn at a time per call. */
  chain: Promise<void>;
  last?: Turn;
  /** "Are you still there?" after the caller went quiet; once per silence. */
  checkIn?: Turn;
  ended: boolean;
  lastSeen: number;
  /** The last verification code hash we delivered, so each code is delivered once. */
  textedCode?: string;
  /** The patient whose paired /phone page holds this call's code (when it couldn't be texted). */
  codeOnDevice?: string;
  /** Outbound: the guarded opener, said when they pick up. */
  firstMessage?: string;
  /** Twilio route: the TwiML ElevenLabs gave for this call, so a Twilio retry gets the same. */
  twiml?: string;
  /** Twilio route: the unguessable token in this call's TwiML URL (only Twilio and we see it). */
  twimlToken?: string;
  /** Trial-safe loop: what Twilio's <Gather> heard the caller say, oldest first. */
  heard: string[];
  /** Trial-safe loop: the voiced clips of guarded lines, by number, for <Play>. */
  clips: Buffer[];
  /** Trial-safe loop: silences in a row (a check-in after one, a hang-up after two). */
  quiet: number;
};

type State = { calls: Map<CallId, VoiceCall>; byConversation: Map<string, CallId>; starting: Map<string, Promise<VoiceCall>> };
const holder = globalThis as typeof globalThis & { __aegisVoiceLine?: State };
const state = (): State => (holder.__aegisVoiceLine ??= { calls: new Map(), byConversation: new Map(), starting: new Map() });

export function resetVoiceLineForTests(): void {
  holder.__aegisVoiceLine = undefined;
}

export function voiceCall(callId: CallId): VoiceCall | undefined {
  return state().calls.get(callId);
}

export function openVoiceCalls(): VoiceCall[] {
  return [...state().calls.values()].filter((c) => !c.ended);
}

// ---------- Auth ----------

function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/**
 * null if the request carries VOICE_LLM_SECRET, else the response to send. ElevenLabs sends its
 * custom-LLM API key as `Authorization: Bearer <secret>`; `x-aegis-voice-secret` also works (for
 * a request header set in their dashboard). No secret configured: closed.
 */
export function voiceSecretRefused(request: Request): Response | null {
  const secret = process.env.VOICE_LLM_SECRET ?? "";
  if (secret.length < 16) return fail(503, "The phone line isn't set up (VOICE_LLM_SECRET, 16+ characters)");
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (request.headers.get("x-aegis-voice-secret") ?? "");
  return given && sameSecret(given, secret) ? null : fail(401, "Unauthorized");
}

// ---------- Requests ----------

export type ChatRequest = {
  /** The caller's messages, oldest first: what ElevenLabs heard them say. */
  callerTexts: string[];
  callId?: string;
  conversationId?: string;
  stream: boolean;
  model: string;
  /** ElevenLabs offered its end_call system tool, so we can hang up when our driver ends the call. */
  canEndCall: boolean;
};

const CONVERSATION_TAG = /\[aegis-conversation:([A-Za-z0-9_-]{1,128})\]/;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join(" ");
  }
  return "";
}

/** Read an OpenAI Chat Completions body as ElevenLabs sends it. */
export function parseChatRequest(body: Record<string, unknown>): ChatRequest | { error: string } {
  if (!Array.isArray(body.messages)) return { error: "Body must have messages: an array" };
  const messages = body.messages.filter((m): m is { role: unknown; content: unknown } => !!m && typeof m === "object");
  const extra = (body.elevenlabs_extra_body ?? {}) as Record<string, unknown>;
  const rawId = typeof extra.aegis_call_id === "string" ? extra.aegis_call_id : typeof body.aegis_call_id === "string" ? body.aegis_call_id : undefined;
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    callerTexts: messages.filter((m) => m.role === "user").map((m) => textOf(m.content).trim()),
    callId: rawId,
    conversationId: CONVERSATION_TAG.exec(system)?.[1],
    stream: body.stream === true,
    model: typeof body.model === "string" ? body.model.slice(0, 64) : "aegis",
    canEndCall: tools.some((t) => (t as { function?: { name?: unknown } })?.function?.name === "end_call"),
  };
}

// ---------- Calls ----------

/**
 * A call the voice line started: by the outbound route, or for an inbound phone call. Its phone
 * token is taken here and thrown away, so no browser phone can answer or speak on it.
 */
export function registerVoiceCall(callId: CallId, direction: Direction, conversationId?: string): VoiceCall {
  issuePhoneToken(callId);
  const call: VoiceCall = { callId, direction, conversationId, opened: false, handled: 0, turns: new Map(), chain: Promise.resolve(), ended: false, lastSeen: Date.now(), heard: [], clips: [], quiet: 0 };
  state().calls.set(callId, call);
  if (conversationId) state().byConversation.set(conversationId, callId);
  return call;
}

/** Note the ElevenLabs conversation an outbound call became (from their outbound-call reply). */
export async function linkConversation(call: VoiceCall, conversationId: string): Promise<void> {
  if (call.conversationId) return;
  call.conversationId = conversationId;
  state().byConversation.set(conversationId, call.callId);
  await getStore().appendRecord({
    callId: call.callId, actor: "system", kind: "safety", input: { check: "voice_conversation" },
    output: { internal: { conversationId } },
  }).catch(() => console.warn("Could not save the recording reference for this call."));
}

/** Opened through the driver's own fixed opening, outside a request (the outbound route does this). */
export async function openVoiceCall(call: VoiceCall): Promise<string[]> {
  call.opened = true;
  const driver = getDriver() as JoinableDriver;
  const events = await answerCall(driver, getStore(), call.callId);
  // The opener says "I'll send a code to this phone"; when it went to the paired page instead, say so.
  if ((await deliverCode(call)) === "device" && call.direction === "outbound" && driver.speakLine) {
    for await (const event of driver.speakLine(call.callId, CODE_ON_FILE)) events.push(forCaller(event));
  }
  return events.map(forCaller).flatMap((e) => (e.type === "line" ? [e.text] : []));
}

/** Hang up our side of a phone call: the driver forgets it and the control layer ends it. */
export async function endVoiceCall(call: VoiceCall): Promise<void> {
  if (call.ended) return;
  call.ended = true;
  await call.chain.catch(() => {});
  const stored = await getStore().getCall(call.callId);
  if (stored && stored.state !== "ended") await getDriver().endCall(call.callId).catch(() => {});
}

/** End calls ElevenLabs stopped asking about: the person hung up. */
export async function endIdleVoiceCalls(now = Date.now()): Promise<void> {
  for (const call of openVoiceCalls()) if (now - call.lastSeen > VOICE_IDLE_MS) await endVoiceCall(call);
}

async function startInbound(conversationId: string): Promise<VoiceCall> {
  const s = state();
  const pending = s.starting.get(conversationId);
  if (pending) return pending;
  const started = getDriver()
    .startCall({ direction: "inbound" })
    .then(async (callId) => {
      const call = registerVoiceCall(callId, "inbound");
      await linkConversation(call, conversationId);
      return call;
    })
    .finally(() => s.starting.delete(conversationId));
  s.starting.set(conversationId, started);
  return started;
}

/** The call this request is about, or the error response. */
export async function findVoiceCall(chat: ChatRequest): Promise<VoiceCall | Response> {
  await endIdleVoiceCalls();
  const s = state();
  let call: VoiceCall | undefined;
  if (chat.callId) {
    call = s.calls.get(chat.callId);
    if (!call) return fail(404, "That isn't a call on the phone line");
    if (chat.conversationId && !call.conversationId) await linkConversation(call, chat.conversationId);
  } else if (chat.conversationId) {
    const known = s.byConversation.get(chat.conversationId);
    call = known ? s.calls.get(known) : await startInbound(chat.conversationId);
  }
  if (!call) return fail(400, "Can't tell which call this is: no aegis_call_id and no [aegis-conversation:...] tag");
  call.lastSeen = Date.now();
  return call;
}

// ---------- Turns ----------

function newTurn(): Turn {
  return { lines: [], done: false, ended: false, delivered: false, wake: new Set() };
}

function wake(turn: Turn): void {
  for (const fn of turn.wake) fn();
  turn.wake.clear();
}

function finished(ended: boolean): Turn {
  return { ...newTurn(), done: true, ended, delivered: true };
}

/**
 * The turn for this request. ElevenLabs sends the whole conversation each time, so the caller
 * messages past `handled` are new. A request with no new caller words (a retry after a dropped
 * connection, or a second request for the same turn) gets the turn that already ran: the driver
 * never sees a line twice, so a button is never pressed twice for one thing said.
 */
export function takeTurn(call: VoiceCall, callerTexts: string[]): Turn {
  const count = callerTexts.length;
  const seen = call.turns.get(count);
  // Still running, or its answer never fully reached ElevenLabs: the same turn again.
  if (seen && !(seen.done && seen.delivered)) return seen;
  if (call.ended) return finished(true);
  // Asked again with nothing new after they heard us: the caller has gone quiet (turn timeout).
  if (seen) return silence(call);
  if (count < call.handled) return finished(false);
  const turn = newTurn();
  call.turns.set(count, turn);
  const fresh = callerTexts.slice(call.handled).filter(Boolean);
  call.handled = count;
  call.checkIn = undefined;
  const previous = call.last;
  call.last = turn;
  call.chain = call.chain.then(() => play(call, turn, fresh, previous));
  return turn;
}

/** The driver's own check-in line, once per silence (task 1.8); after that, nothing. */
function silence(call: VoiceCall): Turn {
  if (call.checkIn) return call.checkIn.delivered ? finished(false) : call.checkIn;
  const turn = newTurn();
  call.checkIn = turn;
  call.chain = call.chain.then(async () => {
    try {
      for (const event of (await checkInCall(getDriver() as JoinableDriver, call.callId)) ?? []) if (event.type === "line") say(turn, event.text);
    } catch (error) {
      console.warn(`voice: check-in on ${call.callId} failed (${error instanceof Error ? error.message : "unknown error"})`);
    } finally {
      turn.done = true;
      wake(turn);
    }
  });
  return turn;
}

function say(turn: Turn, text: string): void {
  turn.lines.push(text);
  wake(turn);
}

async function play(call: VoiceCall, turn: Turn, fresh: string[], previous?: Turn): Promise<void> {
  try {
    // The caller spoke again before hearing our last answer (ElevenLabs dropped that request):
    // say it now, before the answer to what they just said.
    if (previous && !previous.delivered) {
      previous.delivered = true;
      for (const line of previous.lines) say(turn, line);
    }
    if (!call.opened) {
      const opening = await openVoiceCall(call);
      // Outbound: the person picking up says "Hello?"; the opener is the answer, and the pickup
      // isn't a turn. Inbound: ElevenLabs already spoke its first message, the same fixed
      // greeting (scripts/elevenlabs-agent.ts), so the opening only goes on the record.
      if (call.direction === "outbound") {
        for (const line of opening) say(turn, line);
        return;
      }
    }
    const text = fresh.join(" ").trim().slice(0, VOICE_MAX_LINE);
    if (!text) return;
    for await (const raw of getDriver().callerSays(call.callId, text)) {
      const event = forCaller(raw);
      if (event.type === "line") say(turn, event.text);
      if (event.type === "ended") turn.ended = true;
    }
    if ((await getStore().getCall(call.callId))?.state === "ended") turn.ended = true;
    await deliverCode(call);
  } catch (error) {
    console.warn(`voice: turn on ${call.callId} failed (${error instanceof Error ? error.message : "unknown error"})`);
  } finally {
    if (turn.ended) call.ended = true;
    turn.done = true;
    wake(turn);
  }
}

/** Wait until the turn has more than `seen` lines or is done, or `ms` passes. */
function waitForLine(turn: Turn, seen: number, ms: number): Promise<void> {
  if (turn.done || turn.lines.length > seen) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      turn.wake.delete(done);
      resolve();
    }, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    turn.wake.add(done);
  });
}

export async function untilDone(turn: Turn): Promise<void> {
  while (!turn.done) await waitForLine(turn, turn.lines.length, 60_000);
}

/** The trial-safe loop takes a whole turn at once: every guarded line, and whether the call ended. */
export async function finishTurn(turn: Turn): Promise<{ lines: string[]; ended: boolean }> {
  await untilDone(turn);
  turn.delivered = true;
  return { lines: [...turn.lines], ended: turn.ended };
}

// ---------- Responses (OpenAI Chat Completions shapes) ----------

const END_CALL_REASON = "The pharmacy's assistant ended the call.";

function endCallTool(callId: CallId) {
  return { id: `call_end_${callId}`, type: "function", function: { name: "end_call", arguments: JSON.stringify({ reason: END_CALL_REASON }) } };
}

/** Non-streaming: one chat.completion with every guarded line of the turn. */
export async function completion(turn: Turn, chat: ChatRequest, callId: CallId) {
  await untilDone(turn);
  turn.delivered = true;
  const hangUp = turn.ended && chat.canEndCall;
  return {
    id: `chatcmpl_${callId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: chat.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: turn.lines.join(" "), ...(hangUp ? { tool_calls: [endCallTool(callId)] } : {}) },
        finish_reason: hangUp ? "tool_calls" : "stop",
      },
    ],
  };
}

/** Streaming: each guarded line as a chat.completion.chunk the moment the guard lets it out. */
export function completionStream(turn: Turn, chat: ChatRequest, callId: CallId): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `chatcmpl_${callId}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null = null) =>
    encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: chat.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(chunk({ role: "assistant", content: "" }));
      let sent = 0;
      while (!cancelled) {
        while (sent < turn.lines.length) {
          controller.enqueue(chunk({ content: `${sent > 0 ? " " : ""}${turn.lines[sent]}` }));
          sent++;
        }
        if (turn.done) break;
        const before = turn.lines.length;
        await waitForLine(turn, sent, KEEP_ALIVE_MS);
        // An SSE comment: keeps the connection open while the agent thinks, and says nothing.
        if (!cancelled && !turn.done && turn.lines.length === before) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }
      if (cancelled) return;
      turn.delivered = true;
      const hangUp = turn.ended && chat.canEndCall;
      if (hangUp) controller.enqueue(chunk({ tool_calls: [{ index: 0, ...endCallTool(callId) }] }));
      controller.enqueue(chunk({}, hangUp ? "tool_calls" : "stop"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
}

// ---------- The verification code: a text, or the paired /phone page ----------

/** Said on an outbound call when the code went to the paired device, not to this phone. Through guardSentence like every line. */
export const CODE_ON_FILE = "I've sent a code to the phone we have on file.";

type CodeInternal = { codeSent?: boolean; codeHash?: string; patientId?: string };

/**
 * The control layer sends a code "to the phone on file". On the real phone line that's first a
 * text to TEST_PATIENT_PHONE, for Sam only (the one seed patient that number stands in for). When
 * that can't happen (a Twilio trial's shared number can't text, or another patient), the code is
 * held for that patient's paired /phone page, which reads it with GET /api/phone/code. Either way
 * the code itself comes from control.codeFor, so its expiry and attempt limits are the lock's.
 * Never logged, never said on the call. Returns where this call's newest code went.
 */
async function deliverCode(call: VoiceCall): Promise<"sms" | "device" | undefined> {
  const entry = (await getStore().listRecord(call.callId)).filter((e) => (e.output as { internal?: CodeInternal } | undefined)?.internal?.codeSent).at(-1);
  const internal = (entry?.output as { internal?: CodeInternal } | undefined)?.internal;
  if (!internal?.codeHash || !internal.patientId || internal.codeHash === call.textedCode) return undefined;
  const code = await getControl().codeFor(call.callId);
  if (!code) return undefined;
  call.textedCode = internal.codeHash;
  if (internal.patientId === IDS.sam && smsConfigured() && (await sendSms(`Your pharmacy verification code is ${code}.`))) {
    call.codeOnDevice = undefined;
    return "sms";
  }
  call.codeOnDevice = internal.patientId;
  return "device";
}

/** The code waiting for this patient's paired /phone page: the newest open phone-line call that sent one there. */
export async function codeForDevice(patientId: string): Promise<string | undefined> {
  const calls = openVoiceCalls().filter((c) => c.codeOnDevice === patientId);
  for (const call of calls.reverse()) {
    const code = await getControl().codeFor(call.callId);
    if (code) return code;
  }
  return undefined;
}
