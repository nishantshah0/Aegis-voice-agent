import type { CallId, Lane, Patient, Prescription, RuleId, Signal, Store } from "@/lib/contract";
import { chooseLane, evaluate, loadContext, signalsFromCards, type Control } from "@/lib/control";
import { emit } from "@/lib/events";
import { PHARMACY_NAME } from "@/lib/seed";
import { recordRing } from "./devices";

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

/** Patients with an outbound call that hasn't ended. */
export async function patientsOnOpenCalls(store: Store): Promise<Set<string>> {
  const starts = (await store.listRecord()).filter(
    (e) => e.kind === "safety" && (e.input as { check?: string; direction?: string })?.direction === "outbound" && e.callId,
  );
  const calls = await Promise.all(starts.map((e) => store.getCall(e.callId as CallId)));
  return new Set(calls.filter((c) => c && c.state !== "ended" && c.targetPatientId).map((c) => c!.targetPatientId!));
}

/** Start an outbound call through rule 7 and ring the patient's paired phone. */
export async function ringPatient(control: Control, patientId: string, rxId: string): Promise<{ ok: true; callId: CallId } | { ok: false; ruleIds: RuleId[] }> {
  const started = await control.startOutboundCall(patientId, rxId);
  if (!started.ok) return { ok: false, ruleIds: started.ruleIds };
  recordRing(started.callId, patientId);
  emit({ type: "phone", callId: started.callId, kind: "ring", text: `${PHARMACY_NAME} is calling` });
  return { ok: true, callId: started.callId };
}
