import type { AgentEvent, ButtonResult } from "@/lib/contract";
import type { QueueItem, StreamEvent } from "./types";

// Who is listening decides what they get (review finding, Trail #3):
//   staff  (signed in)      everything
//   phone  (its call token) only its own call's lines, blocked lines and phone events
//   public (anyone else)    presses, scores, the clock, rings, statuses, redacted queue items
// Nobody ever gets a verification code's digits, and only staff get a blocked line's original.

export type Audience =
  | { kind: "staff" }
  | { kind: "phone"; callId: string }
  // A patient's paired phone before it answers: only rings for that patient (Trail #19).
  | { kind: "device"; patientId: string; ringTarget: (callId: string) => string | undefined }
  | { kind: "public" };

const CODE_SENT = "A verification code was sent to your phone.";

function redactItem(item: QueueItem): QueueItem {
  return {
    id: item.id,
    callId: item.callId,
    patientId: "",
    kind: item.kind,
    lane: item.lane,
    ruleIds: item.ruleIds,
    signals: item.signals,
    notes: [],
    status: item.status,
    createdAt: item.createdAt,
  };
}

export function forAudience(event: StreamEvent, audience: Audience): StreamEvent | null {
  if (event.type === "phone" && event.kind === "code") {
    const safe: StreamEvent = { ...event, text: CODE_SENT };
    if (audience.kind === "staff") return safe;
    return audience.kind === "phone" && audience.callId === event.callId ? safe : null;
  }
  if (audience.kind === "staff") return event;

  if (audience.kind === "device") {
    if (event.type === "clock") return event;
    const ringsHere = event.type === "phone" && event.kind === "ring" && audience.ringTarget(event.callId) === audience.patientId;
    return ringsHere ? event : null;
  }

  if (audience.kind === "phone") {
    if (!("callId" in event) || event.callId !== audience.callId) return event.type === "clock" ? event : null;
    if (event.type === "press") return null;
    return event.type === "blocked_line" ? { ...event, original: "" } : event;
  }

  switch (event.type) {
    case "line":
      return null;
    case "blocked_line":
      return { ...event, original: "" };
    case "queue":
      return { type: "queue", item: redactItem(event.item) };
    case "phone":
      // Rings are public but carry no call id: only the paired device can tell which call.
      return event.kind === "ring" ? { ...event, callId: "" } : event;
    default:
      return event;
  }
}

/**
 * A driver event as the caller may see it in a say, answer or check-in response, shaped like the
 * phone audience on the stream (Trail #19): a blocked line keeps its rule and replacement but
 * never its original, and a press keeps only its button and outcome, no input or output.
 */
export function forCaller(event: AgentEvent): AgentEvent {
  if (event.type === "blocked_line") return { ...event, original: "" };
  if (event.type === "press") {
    const { result } = event;
    const outcome = (result.ok ? { ok: true, output: {}, ruleIds: result.ruleIds } : { ok: false, error: result.error, ruleIds: result.ruleIds }) as ButtonResult;
    return { type: "press", button: event.button, input: {}, result: outcome };
  }
  return event;
}
