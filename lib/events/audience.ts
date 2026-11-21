import type { QueueItem, StreamEvent } from "./types";

// Who is listening decides what they get (review finding, Trail #3):
//   staff  (signed in)      everything
//   phone  (its call token) only its own call's lines, blocked lines and phone events
//   public (anyone else)    presses, scores, the clock, rings, statuses, redacted queue items
// Nobody ever gets a verification code's digits, and only staff get a blocked line's original.

export type Audience = { kind: "staff" } | { kind: "phone"; callId: string } | { kind: "public" };

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
    default:
      return event;
  }
}
