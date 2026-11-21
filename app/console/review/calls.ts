import type { ButtonName, CallId, QueueItem, RecordDecision, RecordEntry, RuleId, SpeechRule, Store } from "@/lib/contract";

// Finished calls for hand labelling (SPEC Part 2, "Review calls"), built only from the
// store's calls, queue and decision record. Nothing here decides anything.

export type ReviewLine = { who: "agent" | "caller"; text: string; blocked?: SpeechRule };
export type ReviewCall = {
  callId: CallId;
  direction: "inbound" | "outbound";
  startedAt: string;
  endedAt?: string;
  /** Initials only, like Today. */
  patient: string;
  verified: boolean;
  transcript: ReviewLine[];
  buttons: { button: ButtonName; decision?: RecordDecision; ruleIds: RuleId[] }[];
  blocked: { text: string; rule: SpeechRule; replacement: string }[];
  outcome: string[];
};

const LANE: Record<QueueItem["lane"], string> = { automatic: "Automatic", quick_check: "Quick check", review: "Review" };
const STATUS: Record<QueueItem["status"], string> = { open: "waiting", approved: "approved", denied: "denied" };

const textOf = (e: RecordEntry) => (e.input as { text?: string } | undefined)?.text ?? "";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function describeCall(store: Store, callId: CallId, record: RecordEntry[], queue: QueueItem[]): Promise<ReviewCall | null> {
  const call = await store.getCall(callId);
  if (!call || call.state !== "ended") return null;
  const patientId = call.lockedPatientId ?? call.targetPatientId;
  const patient = patientId ? await store.getPatient(patientId) : undefined;

  const transcript: ReviewLine[] = [];
  const blocked: ReviewCall["blocked"] = [];
  for (const e of record) {
    if (e.kind === "caller_line") transcript.push({ who: "caller", text: textOf(e) });
    if (e.kind === "line_spoken") transcript.push({ who: "agent", text: textOf(e) });
    if (e.kind === "line_blocked") {
      const out = e.output as { rule: SpeechRule; replacement: string };
      transcript.push({ who: "agent", text: textOf(e), blocked: out.rule });
      blocked.push({ text: textOf(e), rule: out.rule, replacement: out.replacement });
    }
  }

  const items = queue.filter((q) => q.callId === callId);
  const outcome = [call.lockedPatientId ? "Verified" : "Never verified"];
  for (const item of items) {
    const rx = item.rxId ? await store.getPrescription(item.rxId) : undefined;
    outcome.push(`${capital(item.kind)}${rx ? ` (${rx.drug} ${rx.strength})` : ""}: ${LANE[item.lane]} lane, ${STATUS[item.status]}`);
  }
  if (!items.length) outcome.push("Nothing sent to the pharmacist");

  return {
    callId,
    direction: call.direction,
    startedAt: call.startedAt,
    ...(call.endedAt ? { endedAt: call.endedAt } : {}),
    patient: patient ? `${patient.firstName[0]}.${patient.lastName[0]}.` : "Unknown caller",
    verified: Boolean(call.lockedPatientId),
    transcript,
    buttons: record
      .filter((e) => e.kind === "button" && e.button)
      .map((e) => ({ button: e.button!, ...(e.decision ? { decision: e.decision } : {}), ruleIds: e.ruleIds ?? [] })),
    blocked,
    outcome,
  };
}

/** Every call that has ended, newest first. */
export async function finishedCalls(store: Store): Promise<ReviewCall[]> {
  const [record, queue] = await Promise.all([store.listRecord(), store.queue()]);
  const byCall = new Map<CallId, RecordEntry[]>();
  for (const e of record) {
    if (!e.callId) continue;
    const list = byCall.get(e.callId) ?? [];
    list.push(e);
    byCall.set(e.callId, list);
  }
  const newestFirst = [...byCall.entries()].sort((a, b) => b[1][0]!.seq - a[1][0]!.seq);
  const calls = await Promise.all(newestFirst.map(([id, entries]) => describeCall(store, id, entries, queue)));
  return calls.filter((c): c is ReviewCall => c !== null);
}
