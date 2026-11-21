// Event stream (DESIGN 3.6). Whoever produces an event emits it (Role 2 DECISION):
// the driver emits lines, the control layer emits presses, the guard emits blocked lines.

import type { ButtonName } from "./buttons";
import type { CallId, IsoTime, Lane, RuleId, SpeechRule } from "./ids";
import type { QueueItem } from "./store";

export type PressDecision = "allowed" | "routed" | "refused" | "flagged";

export type StreamEvent =
  | { type: "line"; callId: CallId; who: "agent" | "caller"; text: string }
  | { type: "blocked_line"; callId: CallId; rule: SpeechRule; original: string; replacement: string }
  | { type: "press"; callId: CallId; button: ButtonName; decision: PressDecision; ruleIds: RuleId[]; lane?: Lane }
  | { type: "phone"; callId: CallId; kind: "ring" | "code" | "status"; text: string }
  | { type: "queue"; item: QueueItem }
  | { type: "score"; caught: number; broken: number }
  | { type: "clock"; now: IsoTime };

export type StreamEventType = StreamEvent["type"];

export type EmitFn = (event: StreamEvent) => void;
