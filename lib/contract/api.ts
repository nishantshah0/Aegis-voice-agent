// Request and response bodies for the /api routes (SPEC Part 5, "Page endpoints").
// Errors are { error } with an HTTP status (Role 2 DECISION).

import type { AgentEvent, StartCallOpts } from "./driver";
import type { CallId, IsoTime } from "./ids";
import type { QueueItem, RecordEntry } from "./store";

export type ApiError = { error: string };

export type CallStartRequest = StartCallOpts;
export type CallStartResponse = { callId: CallId };

export type CallSayRequest = { text: string };
export type CallSayResponse = { events: AgentEvent[] };

export type DecideRequest = { decision: "approve" | "deny"; note?: string };
export type DecideResponse = { item: QueueItem };

export type ClockRequest = { now: IsoTime };
export type ClockResponse = { now: IsoTime };

export type ResetResponse = { now: IsoTime };

export type RunDailyCheckResponse = { callIds: CallId[]; skipped: { patientId: string; ruleIds: string[] }[] };

export type CallRecordResponse = { entries: RecordEntry[]; headHash: string };

export type GateLatestResponse = {
  ranAt: IsoTime;
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
};
