// Event types come from the contract (DESIGN 3.6). This file only adds the
// shape the stream sends: the event plus its position.
import type { StreamEvent } from "@/lib/contract";

export type { CallId, Lane, QueueItem, SpeechRule, PressDecision, StreamEvent, StreamEventType, EmitFn } from "@/lib/contract";

/** What the server sends: the event plus its position in the stream. */
export type Delivered = { id: number; event: StreamEvent };
