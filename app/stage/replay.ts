// The latest real call, rebuilt from the hash-chained record as the same events the live
// stream sends (AUDIT #12: the Live gate and the stage were blank after a call). Each event
// goes through Role 2's audience filter, so the public projector gets exactly what the
// public stream would have given it: presses and a redacted queue, no lines, no originals.

import type { QueueItem, RecordEntry, SpeechRule, StreamEvent } from "@/lib/contract";
import { forAudience, type Audience } from "@/lib/events/audience";

const text = (value: unknown): string => {
  const t = (value as { text?: unknown } | undefined)?.text;
  return typeof t === "string" ? t : "";
};

function toEvents(entry: RecordEntry, callId: string): StreamEvent[] {
  switch (entry.kind) {
    case "caller_line":
      return [{ type: "line", callId, who: "caller", text: text(entry.input) }];
    case "line_spoken":
      return [{ type: "line", callId, who: "agent", text: text(entry.input) }];
    case "line_blocked": {
      const out = (entry.output ?? {}) as { rule?: unknown; replacement?: unknown };
      const rule = typeof out.rule === "string" ? out.rule : "S1";
      const replacement = typeof out.replacement === "string" ? out.replacement : "";
      return [
        { type: "blocked_line", callId, rule: rule as SpeechRule, original: text(entry.input), replacement },
        { type: "line", callId, who: "agent", text: replacement },
      ];
    }
    case "button": {
      if (!entry.button) return [];
      const decision = entry.decision === "blocked" || !entry.decision ? "refused" : entry.decision;
      return [
        {
          type: "press",
          callId,
          button: entry.button,
          decision,
          ruleIds: entry.ruleIds ?? [],
          ...(entry.lane ? { lane: entry.lane } : {}),
        },
      ];
    }
    default:
      return [];
  }
}

/** The newest call in the record, as events for this audience, plus its open queue items. */
export function latestCallEvents(record: RecordEntry[], queue: QueueItem[], audience: Audience): { callId: string | null; events: StreamEvent[] } {
  const last = [...record].reverse().find((e) => e.callId && !e.callId.startsWith("hijack_"));
  const callId = last?.callId ?? null;
  if (!callId) return { callId: null, events: [] };
  const events: StreamEvent[] = [
    ...record.filter((e) => e.callId === callId).flatMap((e) => toEvents(e, callId)),
    ...queue.filter((q) => q.callId === callId && q.status === "open").map((item): StreamEvent => ({ type: "queue", item })),
  ];
  return { callId, events: events.map((e) => forAudience(e, audience)).filter((e): e is StreamEvent => e !== null) };
}
