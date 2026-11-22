// Later signals re-lane a call's open requests (Trail #86, RT-C3). Triage used to read a call's
// signals once, when the refill was requested, so a crisis line, an overdose, a replaced false
// promise or failed codes said afterwards left an Automatic or Quick check refill where it was.
// Now every record entry that is a signal moves that call's open refill, renewal and delivery
// items to Review (an Automatic refill's order goes back to waiting for a pharmacist), and the
// move is written to the record. Decided in code from the record, never by the AI.
//
// Every signal reaches the record (the speech guard, the safety check and the buttons all append
// there), so the hook sits on the store's appendRecord: withSignalRelane wraps a store once, where
// it's created, and covers every caller of it.

import type { QueueItem, RecordEntry, RecordEntryInput, Signal, Store } from "@/lib/contract";

/** The signal a record entry raises for its call, if any. */
export function signalOf(e: RecordEntry | RecordEntryInput): Signal | undefined {
  if (e.kind === "line_blocked") return "speech_guard_replacement";
  // The caller's own safety words (actor caller). The system's checks (call start, outbound, re-lanes) aren't signals.
  if (e.kind === "safety" && e.actor !== "system") return "safety_words";
  if (e.kind === "button" && e.button === "check_code" && e.decision === "blocked") return "failed_code_attempts";
  return undefined;
}

const RELANED_KINDS: ReadonlySet<QueueItem["kind"]> = new Set(["refill", "renewal", "delivery"]);

/** Move the call's open requests to Review for this entry's signal. Returns the items it changed. */
export async function relaneForSignal(store: Store, entry: RecordEntry): Promise<QueueItem[]> {
  const signal = signalOf(entry);
  if (!signal || !entry.callId) return [];
  const open = (await store.queue()).filter(
    (q) => q.status === "open" && q.callId === entry.callId && RELANED_KINDS.has(q.kind) && (q.lane !== "review" || !q.signals.includes(signal)),
  );
  if (open.length === 0) return [];
  const moved: QueueItem[] = [];
  for (const q of open) {
    moved.push(await store.updateQueueItem(q.id, { lane: "review", signals: q.signals.includes(signal) ? q.signals : [...q.signals, signal] }));
    // An Automatic refill was queued for filling: hold it for the pharmacist instead.
    if (q.orderId && q.kind === "refill") {
      const order = (await store.listOrders(q.patientId)).find((o) => o.id === q.orderId);
      if (order?.state === "queued") await store.saveOrder({ ...order, state: "waiting_for_pharmacist" });
    }
  }
  await store.appendRecord({
    callId: entry.callId,
    actor: "system",
    kind: "safety",
    input: { check: "relane", signal, cause_seq: entry.seq, items: open.map((q) => ({ id: q.id, kind: q.kind, from: q.lane })) },
    decision: "routed",
    lane: "review",
  });
  return moved;
}

/**
 * The store, with appendRecord followed by relaneForSignal. Apply it once where a store is made.
 * The re-lane's own record entry is a system safety check, which raises no signal, so it never loops.
 */
export function withSignalRelane<S extends Store>(store: S): S {
  const appendRecord: Store["appendRecord"] = async (input) => {
    const entry = await store.appendRecord(input);
    if (signalOf(entry)) await relaneForSignal(store, entry);
    return entry;
  };
  return Object.assign(Object.create(Object.getPrototypeOf(store)) as S, store, { appendRecord });
}

export const isRelaneEntry = (e: RecordEntry) => e.kind === "safety" && (e.input as { check?: string } | undefined)?.check === "relane";
