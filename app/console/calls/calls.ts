import type { Call, CallId, Lane, RecordEntry, RuleId, SpeechRule, Store } from "@/lib/contract";
import { findBrokenLink } from "@/lib/store/memory";
import { median, type ServerTurnTiming } from "@/lib/voice/timing";
import { laneTotals, type LaneTotals } from "../today/detail";

// 2.9b: what the voice agent did, from the record (never from the model's own account).
// Every call with its transcript, the buttons it pressed and how the lock answered, the
// lines the speech guard blocked, server-side turn timing, and the whole record chain
// checked with findBrokenLink. Usage comes from results/agent-usage.jsonl.

export type PressOutcome = "allowed" | "routed" | "refused" | "flagged";
export type Press = { button: string; outcome: PressOutcome; ruleIds: RuleId[]; lane?: Lane };
export type Blocked = { rule: SpeechRule; original: string; replacement: string };
export type Line = { who: "agent" | "caller"; text: string; blocked?: SpeechRule };
export type CallTiming = { turns: number; medianFirstModelTextMs?: number; medianFirstGuardedMs?: number };

export type CallSummary = {
  callId: CallId;
  direction: Call["direction"];
  state: Call["state"];
  startedAt: string;
  endedAt?: string;
  patient?: string;
  transcript: Line[];
  presses: Press[];
  blocked: Blocked[];
  record: { entries: number };
  timing?: CallTiming;
};

export type CallsOverview = {
  calls: CallSummary[];
  lanes: LaneTotals;
  chain: { entries: number; verified: boolean; brokenAt: number | null; headHash: string };
};

export type TimingSource = { turnTimings?(callId: CallId): ServerTurnTiming[] };

const OUTCOME: Record<string, PressOutcome> = { allowed: "allowed", routed: "routed", blocked: "refused", flagged: "flagged" };
const text = (e: RecordEntry) => (e.input as { text?: string } | undefined)?.text ?? "";

function timingOf(source: TimingSource | undefined, callId: CallId): CallTiming | undefined {
  const turns = source?.turnTimings?.(callId) ?? [];
  if (turns.length === 0) return undefined;
  return {
    turns: turns.length,
    medianFirstModelTextMs: median(turns.flatMap((t) => (t.firstModelTextMs === undefined ? [] : [t.firstModelTextMs]))),
    medianFirstGuardedMs: median(turns.flatMap((t) => (t.firstGuardedMs === undefined ? [] : [t.firstGuardedMs]))),
  };
}

export async function callsOverview(store: Store, { driver }: { driver?: TimingSource } = {}): Promise<CallsOverview> {
  const all = await store.listRecord();
  return summarizeCalls(store, all, await laneTotals(store), driver);
}

export async function summarizeCalls(store: Store, all: RecordEntry[], lanes: LaneTotals, driver?: TimingSource): Promise<CallsOverview> {
  const starts = all.filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start" && e.callId).reverse();
  const entriesByCall = Map.groupBy(all, (entry) => entry.callId);
  const patients = new Map((await store.listPatients()).map((patient) => [patient.id, patient]));
  const calls: CallSummary[] = [];

  for (let i = 0; i < starts.length; i += 16) {
    const batch = await Promise.all(starts.slice(i, i + 16).map((start) => store.getCall(start.callId as CallId)));
    for (const call of batch) {
      if (!call) continue;
      const entries = entriesByCall.get(call.id) ?? [];
      const patientId = call.lockedPatientId ?? call.targetPatientId;
      const patient = patientId ? patients.get(patientId) : undefined;
      calls.push({
        callId: call.id,
        direction: call.direction,
        state: call.state,
        startedAt: call.startedAt,
        ...(call.endedAt ? { endedAt: call.endedAt } : {}),
        ...(patient ? { patient: `${patient.firstName[0]}.${patient.lastName[0]}.` } : {}),
        transcript: entries.flatMap((e): Line[] => {
          if (e.kind === "caller_line") return [{ who: "caller", text: text(e) }];
          if (e.kind === "line_spoken") return [{ who: "agent", text: text(e) }];
          if (e.kind === "line_blocked") return [{ who: "agent", text: text(e), blocked: (e.output as { rule: SpeechRule }).rule }];
          return [];
        }),
        presses: entries
          .filter((e) => e.kind === "button" && e.button)
          .map((e) => ({ button: e.button!, outcome: OUTCOME[e.decision ?? "allowed"] ?? "allowed", ruleIds: e.ruleIds ?? [], ...(e.lane ? { lane: e.lane } : {}) })),
        blocked: entries
          .filter((e) => e.kind === "line_blocked")
          .map((e) => {
            const out = e.output as { rule: SpeechRule; replacement: string };
            return { rule: out.rule, original: text(e), replacement: out.replacement };
          }),
        record: { entries: entries.length },
        ...(timingOf(driver, call.id) ? { timing: timingOf(driver, call.id) } : {}),
      });
    }
  }

  const brokenAt = findBrokenLink(all);
  return {
    calls,
    lanes,
    chain: { entries: all.length, verified: brokenAt === null, brokenAt, headHash: all.at(-1)?.hash ?? "" },
  };
}

// ---------- Usage from results/agent-usage.jsonl (Role 1's Agent SDK log) ----------

export type ModelUsage = {
  turns: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};
export type UsageEntryView = { at: string; callId: string; model: string; modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number };
export type Usage = { entries: number; byModel: Record<string, ModelUsage>; recent: UsageEntryView[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function parseUsage(log: string): Usage {
  const rows: UsageEntryView[] = [];
  const byModel: Record<string, ModelUsage> = {};
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    let row: { at?: unknown; callId?: unknown; model?: unknown; modelCalls?: unknown; costUsd?: unknown; usage?: Record<string, unknown> };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row.model !== "string") continue;
    const u = row.usage ?? {};
    const m = (byModel[row.model] ??= { turns: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
    m.turns += 1;
    m.modelCalls += Math.max(1, num(row.modelCalls));
    m.inputTokens += num(u.input_tokens);
    m.outputTokens += num(u.output_tokens);
    m.cacheReadTokens += num(u.cache_read_input_tokens);
    m.cacheWriteTokens += num(u.cache_creation_input_tokens);
    m.costUsd = round6(m.costUsd + num(row.costUsd));
    rows.push({
      at: String(row.at ?? ""),
      callId: String(row.callId ?? ""),
      model: row.model,
      modelCalls: Math.max(1, num(row.modelCalls)),
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd: num(row.costUsd),
    });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { entries: rows.length, byModel, recent: rows.slice(0, 10) };
}
