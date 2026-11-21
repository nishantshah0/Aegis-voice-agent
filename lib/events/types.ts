// TEMPORARY local copy of the event types from docs/DESIGN.md section 3.6.
// Task 0 (lib/contract/) hasn't landed yet. When it does, delete this file's
// definitions and re-export from "@/lib/contract" instead, so nothing else changes.

export type CallId = string;

export type Lane = "automatic" | "quick_check" | "review";

/** Placeholder until the contract defines QueueItem. Only `id` and `lane` are relied on here. */
export type QueueItem = { id: string; lane: Lane } & Record<string, unknown>;

export type SpeechRule = "S1" | "S2" | "S3" | "S4";

export type PressDecision = "allowed" | "routed" | "refused" | "flagged";

export type StreamEvent =
  | { type: "line"; callId: CallId; who: "agent" | "caller"; text: string }
  | { type: "blocked_line"; callId: CallId; rule: SpeechRule; original: string; replacement: string }
  | { type: "press"; callId: CallId; button: string; decision: PressDecision; ruleIds: string[]; lane?: Lane }
  | { type: "phone"; callId: CallId; kind: "ring" | "code" | "status"; text: string }
  | { type: "queue"; item: QueueItem }
  | { type: "score"; caught: number; broken: number }
  | { type: "clock"; now: string };

export type StreamEventType = StreamEvent["type"];

/** What the server sends: the event plus its position in the stream. */
export type Delivered = { id: number; event: StreamEvent };
