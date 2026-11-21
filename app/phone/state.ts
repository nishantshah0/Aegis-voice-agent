// The patient's phone (task 1.4), built only from /api/events plus the phone's own
// taps. A pure reducer, so it's tested without a browser, and everything the phone
// shows came from a real event.

import type { SpeechRule, StreamEvent } from "@/lib/contract";

export type TranscriptItem =
  | { kind: "line"; who: "agent" | "caller"; text: string }
  /** What the agent tried to say and the guard stopped. The caller heard the next agent line instead. */
  | { kind: "blocked"; rule: SpeechRule; original: string; replacement: string };

export type PhoneState = {
  /** idle → ringing (outbound) or dialling (inbound) → in_call → ended */
  mode: "idle" | "ringing" | "dialling" | "in_call" | "ended";
  callId?: string;
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
};

export type PhoneAction =
  | { type: "event"; event: StreamEvent }
  | { type: "dial" }
  | { type: "connected"; callId: string }
  | { type: "code"; code: string }
  | { type: "problem"; text: string }
  | { type: "hung_up" };

export const initialPhone = (): PhoneState => ({ mode: "idle", transcript: [] });

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
      return { ...state, transcript: [...state.transcript, { kind: "line", who: event.who, text: event.text }] };
    case "blocked_line":
      return {
        ...state,
        transcript: [...state.transcript, { kind: "blocked", rule: event.rule, original: event.original, replacement: event.replacement }],
      };
    default:
      return state;
  }
}

export function phoneReducer(state: PhoneState, action: PhoneAction): PhoneState {
  switch (action.type) {
    case "event":
      return onEvent(state, action.event);
    case "dial":
      return { ...initialPhone(), mode: "dialling" };
    case "connected":
      return { ...state, mode: "in_call", callId: action.callId, problem: undefined };
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
