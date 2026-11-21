// The patient's phone (task 1.4), built only from /api/events plus the phone's own
// taps. A pure reducer, so it's tested without a browser, and everything the phone
// shows came from a real event.

import type { AgentEvent, SpeechRule, StreamEvent } from "@/lib/contract";

/** What the stream says when a code goes to the phone; the digits come from the code route. */
export const CODE_SENT_MESSAGE = "A verification code was sent to your phone.";

export type TranscriptItem =
  | { kind: "line"; who: "agent" | "caller"; text: string }
  /** What the agent tried to say and the guard stopped. The caller heard the next agent line instead. */
  | { kind: "blocked"; rule: SpeechRule; original: string; replacement: string };

export type PhoneState = {
  /** idle → ringing (outbound) or dialling (inbound) → in_call → ended */
  mode: "idle" | "ringing" | "dialling" | "in_call" | "ended";
  callId?: string;
  /** The call's phone token, from start or the first answer. Say, code and end need it. */
  phoneToken?: string;
  /** The ring's own text, e.g. "Maple Street Pharmacy is calling". */
  ringText?: string;
  transcript: TranscriptItem[];
  /** The latest text message: the code arrives as one. */
  message?: string;
  /** The code's digits, from GET /api/call/:id/code (control.codeFor), never from the event stream. */
  code?: string;
  /** The latest status line, e.g. "Approved, ready Thursday". */
  status?: string;
  /** Something the phone couldn't do, said plainly. */
  problem?: string;
  /** Opening lines shown from the answer response that the call's stream may still repeat. */
  echoes?: TranscriptItem[];
};

export type PhoneAction =
  | { type: "event"; event: StreamEvent }
  | { type: "dial" }
  | { type: "connected"; callId: string; phoneToken?: string }
  /** The opening the answer (or dial) response returned: it ran before the phone's own stream connected. */
  | { type: "opening"; events: AgentEvent[] }
  | { type: "code"; code: string }
  | { type: "problem"; text: string }
  | { type: "hung_up" };

export const initialPhone = (): PhoneState => ({ mode: "idle", transcript: [] });

const sameItem = (a: TranscriptItem | undefined, b: TranscriptItem) => JSON.stringify(a) === JSON.stringify(b);

/** Add one transcript item from the stream, unless it's the stream's copy of an opening line already shown. */
function addFromStream(state: PhoneState, item: TranscriptItem): PhoneState {
  const [next, ...rest] = state.echoes ?? [];
  if (next && sameItem(next, item)) return { ...state, echoes: rest };
  // Once the caller speaks, the stream is past the opening: nothing more is an echo.
  const echoes = item.kind === "line" && item.who === "caller" ? undefined : state.echoes;
  return { ...state, transcript: [...state.transcript, item], echoes };
}

function onEvent(state: PhoneState, event: StreamEvent): PhoneState {
  if (event.type === "phone" && event.kind === "ring") {
    // Ring only when the phone is free: a second ring mid-call is ignored.
    if (state.mode !== "idle" && state.mode !== "ended") return state;
    return { ...initialPhone(), mode: "ringing", callId: event.callId, ringText: event.text };
  }
  if (!("callId" in event) || event.callId !== state.callId) return state;
  switch (event.type) {
    case "phone":
      // A new code was sent: show the message and fetch the code from the call's own route.
      if (event.kind === "code") return { ...state, message: event.text, code: undefined };
      if (event.kind === "status") return { ...state, status: event.text };
      return state;
    case "line":
      return addFromStream(state, { kind: "line", who: event.who, text: event.text });
    case "blocked_line":
      return addFromStream(state, { kind: "blocked", rule: event.rule, original: event.original, replacement: event.replacement });
    default:
      return state;
  }
}

/**
 * The opening's lines and blocked lines, and the code-sent message if send_code went through.
 * The call's stream carries the same lines, before or after this: whichever comes second is
 * dropped, so the opening shows once.
 */
function onOpening(state: PhoneState, events: AgentEvent[]): PhoneState {
  let next = state;
  let seen = 0; // opening items the stream already showed, at the start of the transcript
  const echoes: TranscriptItem[] = [];
  for (const e of events) {
    let item: TranscriptItem | undefined;
    if (e.type === "line") item = { kind: "line", who: "agent", text: e.text };
    if (e.type === "blocked_line") item = { kind: "blocked", rule: e.rule, original: e.original, replacement: e.replacement };
    if (item) {
      if (sameItem(next.transcript[seen], item)) seen++;
      else {
        next = { ...next, transcript: [...next.transcript, item] };
        echoes.push(item);
      }
    }
    if (e.type === "press" && e.button === "send_code" && e.result.ok) next = { ...next, message: CODE_SENT_MESSAGE, code: undefined };
  }
  return { ...next, echoes: [...(next.echoes ?? []), ...echoes] };
}

/**
 * Which stream the phone listens to. In a call with its token: that call's own stream, the only
 * one that carries its lines (lib/events/audience.ts). Otherwise the plain stream, for rings.
 */
export function phoneListener(state: PhoneState): { callId: string; token: string } | undefined {
  return state.mode === "in_call" && state.callId && state.phoneToken ? { callId: state.callId, token: state.phoneToken } : undefined;
}

export function phoneReducer(state: PhoneState, action: PhoneAction): PhoneState {
  switch (action.type) {
    case "opening":
      return onOpening(state, action.events);
    case "event":
      return onEvent(state, action.event);
    case "dial":
      return { ...initialPhone(), mode: "dialling" };
    case "connected":
      return { ...state, mode: "in_call", callId: action.callId, phoneToken: action.phoneToken ?? state.phoneToken, problem: undefined };
    case "code":
      return { ...state, code: action.code };
    case "problem":
      return { ...state, problem: action.text };
    case "hung_up":
      return { ...state, mode: "ended" };
  }
}

/** The rule's plain name, for the label on a blocked line. */
export const RULE_LABEL: Record<SpeechRule, string> = {
  S1: "S1 · before verification",
  S2: "S2 · someone else's prescription",
  S3: "S3 · dose not on the label",
  S4: "S4 · promise not in the record",
};
