import type { Lane, QueueItem, RecordEntry, RuleId, Signal, SpeechRule, Store } from "@/lib/contract";

// What the pharmacist sees for one queue item (SPEC "The pharmacy console", Today).
// Everything comes from the store and the record; nothing here decides anything.

/** Core rules live in code, not cards (SPEC Part 3, "Core rules"). */
export const CORE_RULES: Record<RuleId, string> = {
  "1": "The call is verified and the prescription belongs to the locked patient.",
  "5": "Delivery goes to pickup or an address already on file.",
};

export type Told = { text: string; blocked: false } | { text: string; blocked: true; rule: SpeechRule; replacement: string };
export type TranscriptLine = { who: "agent" | "caller"; text: string; blocked?: SpeechRule };

export type ItemDetail = {
  id: string;
  callId: string;
  lane: Lane;
  kind: QueueItem["kind"];
  status: QueueItem["status"];
  patient: string;
  drug?: string;
  requestedDaysSupply?: number;
  rules: { id: RuleId; wording: string }[];
  sideEffects: string[];
  questions: string[];
  told: Told[];
  transcript: TranscriptLine[];
  signals: Signal[];
  aiView?: string;
  decidedBy?: string;
  decisionNote?: string;
};

export type LaneTotals = Record<Lane, number>;

export async function laneTotals(store: Store): Promise<LaneTotals> {
  const totals: LaneTotals = { automatic: 0, quick_check: 0, review: 0 };
  for (const item of await store.queue()) totals[item.lane] += 1;
  return totals;
}

const textOf = (e: RecordEntry) => (e.input as { text?: string } | undefined)?.text ?? "";

function agentLine(e: RecordEntry): Told | null {
  if (e.kind === "line_spoken") return { text: textOf(e), blocked: false };
  if (e.kind === "line_blocked") {
    const out = e.output as { rule: SpeechRule; replacement: string };
    return { text: textOf(e), blocked: true, rule: out.rule, replacement: out.replacement };
  }
  return null;
}

export async function itemDetail(store: Store, item: QueueItem): Promise<ItemDetail> {
  const [patient, rx, cards, record, queue] = await Promise.all([
    store.getPatient(item.patientId),
    item.rxId ? store.getPrescription(item.rxId) : Promise.resolve(undefined),
    store.listCards(),
    store.listRecord(item.callId),
    store.queue(),
  ]);
  const wording = (id: RuleId) => CORE_RULES[id] ?? cards.find((c) => c.id === id)?.wording ?? `Rule ${id}`;
  // Notes from the whole call: a side effect is often its own Review item next to the refill.
  const notes = queue.filter((q) => q.callId === item.callId).flatMap((q) => q.notes);
  const lines = record.filter((e) => e.kind === "line_spoken" || e.kind === "line_blocked" || e.kind === "caller_line");

  return {
    id: item.id,
    callId: item.callId,
    lane: item.lane,
    kind: item.kind,
    status: item.status,
    patient: patient ? `${patient.firstName[0]}.${patient.lastName[0]}.` : "Unknown patient",
    ...(item.requestedDaysSupply !== undefined ? { requestedDaysSupply: item.requestedDaysSupply } : {}),
    drug: rx ? `${rx.drug} ${rx.strength}` : undefined,
    rules: item.ruleIds.map((id) => ({ id, wording: wording(id) })),
    sideEffects: [...new Set(notes.filter((n) => n.kind === "side_effect").map((n) => n.text))],
    questions: [...new Set(notes.filter((n) => n.kind === "question").map((n) => n.text))],
    told: lines.flatMap((e) => agentLine(e) ?? []),
    transcript: lines.map((e) => {
      if (e.kind === "caller_line") return { who: "caller" as const, text: textOf(e) };
      const told = agentLine(e)!;
      return told.blocked ? { who: "agent" as const, text: told.text, blocked: told.rule } : { who: "agent" as const, text: told.text };
    }),
    signals: item.signals,
    ...(item.aiView ? { aiView: item.aiView } : {}),
    ...(item.decidedBy ? { decidedBy: item.decidedBy.name } : {}),
    ...(item.decisionNote ? { decisionNote: item.decisionNote } : {}),
  };
}
