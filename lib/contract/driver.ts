// Agent driver (DESIGN 3.4). "Everything is a call": the real Claude agent, the
// hijack agent and the scenario runner all use this one interface.

import type { ButtonName, ButtonResult } from "./buttons";
import type { SafetyResult } from "./guard";
import type { CallId, Direction, PatientId, SpeechRule } from "./ids";

export type AgentEvent =
  | { type: "line"; text: string }
  | { type: "blocked_line"; rule: SpeechRule; original: string; replacement: string }
  | { type: "press"; button: ButtonName; input: unknown; result: ButtonResult }
  | { type: "safety"; result: Exclude<SafetyResult, { action: "continue" }> }
  | { type: "ended" };

export type StartCallOpts = { direction: Direction; patientId?: PatientId };

export interface AgentDriver {
  startCall(opts: StartCallOpts): Promise<CallId>;
  callerSays(callId: CallId, text: string): AsyncIterable<AgentEvent>;
  endCall(callId: CallId): Promise<void>;
}
