import type { Call, CallId, Lane, Order, RecordDecision, RecordEntry, RuleId, SpeechRule, Store } from "@/lib/contract";
import { recordedConversation } from "@/app/api/_lib/call-recording";
import { findBrokenLink } from "@/lib/store/memory";
import type { ServerTurnTiming } from "@/lib/voice/timing";
import type { TimingSource } from "@/app/console/calls/calls";
import { itemDetail, type ItemDetail } from "@/app/console/today/detail";
import { outcomeOf, type CallOutcome } from "../rows";

// One call in full, from the record: every entry in order, what each button press
// returned, the lines the speech guard blocked, the queue items and the pharmacist's
// decision, turn timing, tokens logged under the call id, and the chain check.

export type EventGroup = "speech" | "blocked" | "button" | "safety" | "decision" | "other";

export type TimelineEvent = {
  seq: number;
  at: string;
  group: EventGroup;
  kind: RecordEntry["kind"];
  actor: RecordEntry["actor"];
  /** Spoken or caller text, for speech and blocked lines. */
  text?: string;
  who?: "agent" | "caller";
  /** For a blocked line. */
  rule?: SpeechRule;
  replacement?: string;
  button?: string;
  decision?: RecordDecision;
  ruleIds: RuleId[];
  lane?: Lane;
  /** One-line summary of a press's result or a safety check. */
  summary?: string;
  /** Pretty JSON of input and output, without the control layer's `internal` (as /api/calls/:id/record). */
  input?: string;
  output?: string;
  hash: string;
  prevHash: string;
};

export type DecisionView = ItemDetail & { decidedAt?: string; createdAt: string; order?: Pick<Order, "id" | "state"> };

export type UsageRow = { at: string; model: string; modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number };

export type CallDetail = {
  callId: CallId;
  direction: Call["direction"];
  state: Call["state"];
  startedAt: string;
  endedAt?: string;
  patient?: string;
  verified: boolean;
  outcome: CallOutcome;
  hasRecording?: boolean;
  timeline: TimelineEvent[];
  items: DecisionView[];
  timing: ServerTurnTiming[];
  usage: UsageRow[];
  chain: { entries: number; verified: boolean; brokenAt: number | null; headHash: string; first?: number; last?: number };
};

const textOf = (e: RecordEntry) => (e.input as { text?: string } | undefined)?.text ?? "";
const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v, null, 2));

function withoutInternal(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("internal" in output)) return output;
  const rest: Record<string, unknown> = { ...output };
  delete rest.internal;
  return rest;
}

function pressSummary(output: unknown): string | undefined {
  // Stored as { result: { ok, output | error } } (older entries may be the result itself).
  const outer = output as { result?: unknown } | undefined;
  if (!outer || typeof outer !== "object") return undefined;
  const r = (outer.result ?? outer) as { output?: unknown; error?: unknown };
  for (const source of [r.output, r.error, r]) {
    if (typeof source === "string") return source;
    if (!source || typeof source !== "object") continue;
    const o = source as Record<string, unknown>;
    for (const key of ["message", "reason", "state", "code"]) if (typeof o[key] === "string") return o[key] as string;
  }
  return undefined;
}

export function toEvent(e: RecordEntry): TimelineEvent {
  const base = { seq: e.seq, at: e.at, kind: e.kind, actor: e.actor, ruleIds: e.ruleIds ?? [], hash: e.hash, prevHash: e.prevHash };
  const extra = { ...(e.decision ? { decision: e.decision } : {}), ...(e.lane ? { lane: e.lane } : {}) };
  const raw = { input: json(e.input), output: json(withoutInternal(e.output)) };
  switch (e.kind) {
    case "caller_line":
      return { ...base, ...extra, group: "speech", who: "caller", text: textOf(e) };
    case "line_spoken":
      return { ...base, ...extra, group: "speech", who: "agent", text: textOf(e) };
    case "line_blocked": {
      const out = e.output as { rule: SpeechRule; replacement: string };
      return { ...base, ...extra, group: "blocked", who: "agent", text: textOf(e), rule: out.rule, replacement: out.replacement };
    }
    case "button": {
      const summary = pressSummary(withoutInternal(e.output));
      return { ...base, ...extra, ...raw, group: "button", ...(e.button ? { button: e.button } : {}), ...(summary ? { summary } : {}) };
    }
    case "safety": {
      const check = (e.input as { check?: string } | undefined)?.check;
      const summary = check ? check.replace(/_/g, " ") : textOf(e) ? `Caller line checked: "${textOf(e)}"` : "Safety check";
      return { ...base, ...extra, ...raw, group: "safety", summary };
    }
    case "approval": {
      const input = e.input as { decision?: string; note?: string; approver?: { name?: string } } | undefined;
      const verb = input?.decision === "deny" ? "Declined" : "Approved";
      const summary = `${verb} by ${input?.approver?.name ?? e.actor}${input?.note ? `: "${input.note}"` : ""}`;
      return { ...base, ...extra, ...raw, group: "decision", summary };
    }
    default:
      return { ...base, ...extra, ...raw, group: "other", summary: e.kind.replace(/_/g, " ") };
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Rows of results/agent-usage.jsonl logged under this call id, newest first. */
export function usageFor(log: string, callId: string): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    let row: { at?: unknown; callId?: unknown; model?: unknown; modelCalls?: unknown; costUsd?: unknown; usage?: Record<string, unknown> };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.callId !== callId || typeof row.model !== "string") continue;
    rows.push({
      at: String(row.at ?? ""),
      model: row.model,
      modelCalls: Math.max(1, num(row.modelCalls)),
      inputTokens: num(row.usage?.input_tokens),
      outputTokens: num(row.usage?.output_tokens),
      costUsd: num(row.costUsd),
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export async function callDetail(store: Store, callId: CallId, { driver, usageLog = "" }: { driver?: TimingSource; usageLog?: string } = {}): Promise<CallDetail | null> {
  const call = await store.getCall(callId);
  if (!call) return null;
  const patientId = call.lockedPatientId ?? call.targetPatientId;
  const [all, queue, orders, cards, patient] = await Promise.all([
    store.listRecord(), store.queue(), store.listOrders(), store.listCards(),
    patientId ? store.getPatient(patientId) : undefined,
  ]);
  const entries = all.filter((e) => e.callId === callId).sort((a, b) => a.seq - b.seq);
  const mine = queue.filter((q) => q.callId === callId);
  const items = await Promise.all(
    mine.map(async (item): Promise<DecisionView> => {
      const order = item.orderId ? orders.find((o) => o.id === item.orderId) : undefined;
      return {
        ...(await itemDetail(store, item, { cards, record: entries, queue })),
        createdAt: item.createdAt,
        ...(item.decidedAt ? { decidedAt: item.decidedAt } : {}),
        ...(order ? { order: { id: order.id, state: order.state } } : {}),
      };
    }),
  );
  const presses = entries.filter((e) => e.kind === "button").map((e) => ({ outcome: e.decision === "blocked" ? ("refused" as const) : ("allowed" as const) }));
  const brokenAt = findBrokenLink(all);

  return {
    callId,
    direction: call.direction,
    state: call.state,
    startedAt: call.startedAt,
    ...(call.endedAt ? { endedAt: call.endedAt } : {}),
    ...(patient ? { patient: `${patient.firstName[0]}.${patient.lastName[0]}.` } : {}),
    verified: Boolean(call.lockedPatientId),
    outcome: outcomeOf(presses, mine),
    hasRecording: call.state === "ended" && Boolean(recordedConversation(entries)),
    timeline: entries.map(toEvent),
    items,
    timing: driver?.turnTimings?.(callId) ?? [],
    // Call ids restart after each demo reset, so the log holds older calls under this id too.
    // The store only has the newest one, and its agent ran one turn per caller line, so keep
    // that many of the newest rows.
    usage: usageFor(usageLog, callId).slice(0, entries.filter((e) => e.kind === "caller_line").length),
    chain: {
      entries: all.length,
      verified: brokenAt === null,
      brokenAt,
      headHash: all.at(-1)?.hash ?? "",
      ...(entries.length ? { first: entries[0]!.seq, last: entries.at(-1)!.seq } : {}),
    },
  };
}
