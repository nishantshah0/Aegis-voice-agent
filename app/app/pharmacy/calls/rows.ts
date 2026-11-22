import type { CallId, Lane, QueueItem } from "@/lib/contract";
import type { CallSummary, CallsOverview, Press } from "@/app/console/calls/calls";
import type { Tone } from "@/components/ui";

// Rows for the Calls history list: one per call, from the record (the console's
// callsOverview) plus the queue items the call made. Pure, so the browser can filter
// them. Nothing here decides anything.

/** What became of a call, in the order a pharmacist cares about. */
export type CallOutcome = "waiting" | "denied" | "approved" | "automatic" | "refused" | "nothing";

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  waiting: "Waiting for a pharmacist",
  denied: "Declined",
  approved: "Approved",
  automatic: "Went through on its own",
  refused: "Refused by a rule",
  nothing: "Nothing requested",
};

export const OUTCOME_TONE: Record<CallOutcome, Tone> = { waiting: "review", denied: "stop", approved: "accent", automatic: "accent", refused: "stop", nothing: "neutral" };

export type HistoryRow = {
  callId: CallId;
  direction: CallSummary["direction"];
  state: CallSummary["state"];
  startedAt: string;
  endedAt?: string;
  patient?: string;
  lanes: Lane[];
  outcome: CallOutcome;
  presses: { allowed: number; routed: number; refused: number; flagged: number };
  blocked: number;
  lines: number;
  /** The first few lines, for the hover preview. */
  preview: CallSummary["transcript"];
  /** Everything said on the call, lower case, for the search box. */
  said: string;
};

export type History = {
  rows: HistoryRow[];
  chain: CallsOverview["chain"];
  /** Caller turns per call, to match usage-log rows to this run of a reused call id (as the call page does). */
  callerTurns?: Record<string, number>;
};

export function outcomeOf(presses: Pick<Press, "outcome">[], items: QueueItem[]): CallOutcome {
  const staffed = items.filter((i) => i.lane !== "automatic");
  if (staffed.some((i) => i.status === "open")) return "waiting";
  if (staffed.some((i) => i.status === "denied")) return "denied";
  if (staffed.some((i) => i.status === "approved")) return "approved";
  if (items.length > 0) return "automatic";
  if (presses.some((p) => p.outcome === "refused")) return "refused";
  return "nothing";
}

export function toRow(call: CallSummary, items: QueueItem[]): HistoryRow {
  const count = (o: keyof HistoryRow["presses"]) => call.presses.filter((p) => p.outcome === o).length;
  return {
    callId: call.callId,
    direction: call.direction,
    state: call.state,
    startedAt: call.startedAt,
    ...(call.endedAt ? { endedAt: call.endedAt } : {}),
    ...(call.patient ? { patient: call.patient } : {}),
    lanes: [...new Set(items.map((i) => i.lane))],
    outcome: outcomeOf(call.presses, items),
    presses: { allowed: count("allowed"), routed: count("routed"), refused: count("refused"), flagged: count("flagged") },
    blocked: call.blocked.length,
    lines: call.transcript.length,
    preview: call.transcript.slice(0, 4),
    said: call.transcript.map((l) => l.text).join(" ").toLowerCase(),
  };
}

export type HistoryFilter = { query: string; lane: Lane | "all" | "none"; outcome: CallOutcome | "all" };

/** The search box and the two filters, applied in the browser. */
export function filterRows(rows: HistoryRow[], { query, lane, outcome }: HistoryFilter): HistoryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (outcome !== "all" && r.outcome !== outcome) return false;
    if (lane === "none" && r.lanes.length > 0) return false;
    if (lane !== "all" && lane !== "none" && !r.lanes.includes(lane)) return false;
    if (!q) return true;
    const hay = [r.callId, r.patient ?? "", r.direction, OUTCOME_LABEL[r.outcome], r.said].join(" ").toLowerCase();
    return hay.includes(q);
  });
}
