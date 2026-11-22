import type { CallId, Lane, Order, Patient, Prescription, RuleId, Signal, Store } from "@/lib/contract";
import { chooseLane, evaluate, loadContext, signalsFromCards, type Control } from "@/lib/control";
import { emit } from "@/lib/events";
import { PHARMACY_NAME } from "@/lib/seed";
import { recordRing } from "./devices";
import { wasAnswered } from "./phone";

// Shared by the daily check, Call now and the Upcoming dashboard. Due-soon is ours; every
// decision comes from the control layer's own engine, run read-only, or from
// control.startOutboundCall (rule 7), which is the only way a call to a patient starts.

/** SPEC "The call, outbound", step 1: ring when the supply runs out within 3 days. */
export const DUE_WITHIN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days of supply left at `now` (negative once it has run out). */
export function daysLeft(rx: Prescription, now: string): number {
  return rx.daysSupplied - Math.floor((Date.parse(now) - Date.parse(rx.lastFill)) / DAY_MS);
}

export type Preview =
  | { kind: "lane"; lane: Lane; ruleIds: RuleId[]; signals: Signal[] }
  | { kind: "refused"; ruleIds: RuleId[] };

/** The lane a refill request would land in today, from the rule cards. Never presses, never writes. */
export async function refillPreview(store: Store, patient: Patient, rx: Prescription): Promise<Preview> {
  const verdict = evaluate(await store.listCards(), "request_refill", await loadContext(store, patient, rx));
  if (verdict.outcome === "refuse") return { kind: "refused", ruleIds: verdict.deciding };
  const signals = signalsFromCards(verdict);
  return { kind: "lane", lane: chooseLane(verdict, signals), ruleIds: verdict.matched.map((m) => m.id), signals };
}

/** Rule 7's verdict on ringing this patient now (opt-in, hours, one call per 3 days), from the rule cards. Never writes. */
export async function outboundPreview(store: Store, patient: Patient, rx: Prescription): Promise<{ allowed: boolean; ruleIds: RuleId[] }> {
  const verdict = evaluate(await store.listCards(), "outbound_check", await loadContext(store, patient, rx));
  return { allowed: verdict.outcome === "allowed" || verdict.outcome === "flag", ruleIds: verdict.deciding };
}

/**
 * The daily check's test (SPEC "The call, outbound", step 1): why not to ring about this
 * prescription today, as rule ids, or null if it's due and its refill would pass. Reads
 * only. Exported for the outreach sim (lib/sim, Trail #67) so it uses this exact check.
 */
export async function notDueReason(store: Store, patient: Patient, rx: Prescription): Promise<RuleId[] | null> {
  if (daysLeft(rx, await store.now()) > DUE_WITHIN_DAYS) return ["7"];
  const preview = await refillPreview(store, patient, rx);
  return preview.kind === "refused" ? preview.ruleIds : null;
}

/** Order states that mean a refill is already on its way (AUDIT fix 14). */
const ON_ITS_WAY: readonly Order["state"][] = ["queued", "waiting_for_pharmacist", "approved"];

/** This prescription's refill that is already on its way, if any: no ring, no reminder. */
export async function refillOnItsWay(store: Store, patientId: string, rxId: string): Promise<Order | undefined> {
  return (await store.listOrders(patientId)).find((o) => o.rxId === rxId && ON_ITS_WAY.includes(o.state));
}

/** Patients with an outbound call that hasn't ended. */
export async function patientsOnOpenCalls(store: Store): Promise<Set<string>> {
  const starts = (await store.listRecord()).filter(
    (e) => e.kind === "safety" && (e.input as { check?: string; direction?: string })?.direction === "outbound" && e.callId,
  );
  const calls = await Promise.all(starts.map((e) => store.getCall(e.callId as CallId)));
  return new Set(calls.filter((c) => c && c.state !== "ended" && c.targetPatientId).map((c) => c!.targetPatientId!));
}

/**
 * Start an outbound call through rule 7 and ring the patient's paired phone. Given the store,
 * a ring nobody answers ends as a missed call after ringTimeoutMs() (AUDIT fix 14).
 */
export async function ringPatient(control: Control, patientId: string, rxId: string, store?: Store): Promise<{ ok: true; callId: CallId } | { ok: false; ruleIds: RuleId[] }> {
  const started = await control.startOutboundCall(patientId, rxId);
  if (!started.ok) return { ok: false, ruleIds: started.ruleIds };
  recordRing(started.callId, patientId);
  emit({ type: "phone", callId: started.callId, kind: "ring", text: `${PHARMACY_NAME} is calling` });
  if (store) await hangUpIfUnanswered(store, control, started.callId);
  return { ok: true, callId: started.callId };
}

/** How long a demo-phone ring lasts before it's a missed call (AUDIT fix 14). RING_TIMEOUT_SECONDS overrides. */
export const ringTimeoutMs = () => (Number(process.env.RING_TIMEOUT_SECONDS) || 120) * 1000;

/**
 * After the ring time, end the call as a missed call if its phone never picked up: a
 * "no_answer" safety entry, then the call ends. Each ring has its own marker, because call ids
 * restart after a demo reset: a newer ring of the same id replaces it, and the old timer stops.
 */
const ringsHolder = globalThis as typeof globalThis & { __refillGuardRingMarks?: Map<CallId, object> };
const ringMarks = () => (ringsHolder.__refillGuardRingMarks ??= new Map());

async function hangUpIfUnanswered(store: Store, control: Control, callId: CallId): Promise<void> {
  const mark = {};
  ringMarks().set(callId, mark);
  const timer = setTimeout(() => void endIfUnanswered(store, control, callId, mark).catch(() => {}), ringTimeoutMs());
  (timer as { unref?: () => void }).unref?.();
}

async function endIfUnanswered(store: Store, control: Control, callId: CallId, mark: object): Promise<boolean> {
  if (ringMarks().get(callId) !== mark) return false; // a newer ring of this id
  ringMarks().delete(callId);
  const call = await store.getCall(callId);
  if (!call || call.state === "ended" || wasAnswered(callId)) return false;
  await store.appendRecord({ callId, actor: "system", kind: "safety", input: { check: "no_answer" }, decision: "allowed" });
  await control.endCall(callId);
  emit({ type: "phone", callId, kind: "status", text: "Missed call" });
  return true;
}
