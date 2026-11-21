// Builds the RuleContext a card reads (SPEC Part 3, card fields). Everything comes from
// the store and the record, never from the AI. The context is saved in the record, so a
// card can be replayed against any past request.

import type { ButtonResult, Call, Patient, Prescription, RecordEntry, RuleContext, Store } from "@/lib/contract";
import { DAY_MS, MINUTE_MS, daysBetween, localHour, ms, within } from "./time";

/** What the control layer writes as `output` on a button record entry. */
export type PressRecordOutput = {
  result: ButtonResult;
  /** Facts the AI never sees: which patient a lookup matched, code hashes, and so on. */
  internal: {
    patientId?: string;
    rxId?: string;
    lookupId?: string;
    matched?: boolean;
    codeHash?: string;
    codeSent?: boolean;
    queueItemId?: string;
    orderId?: string;
  };
};

export const internalOf = (e: RecordEntry): PressRecordOutput["internal"] | undefined =>
  e.kind === "button" ? (e.output as PressRecordOutput | undefined)?.internal : undefined;

export const resultOf = (e: RecordEntry): ButtonResult | undefined =>
  e.kind === "button" ? (e.output as PressRecordOutput | undefined)?.result : undefined;

/** Blocked presses against this patient in the last 10 minutes (rule 11). */
export function blockedCount10min(record: RecordEntry[], patientId: string, now: string): number {
  return record.filter(
    (e) => e.kind === "button" && e.decision === "blocked" && internalOf(e)?.patientId === patientId && within(e.at, now, 10 * MINUTE_MS),
  ).length;
}

/** Renewal requests that went out for this prescription in the last 7 days (rule 8). */
export function renewals7d(record: RecordEntry[], rxId: string, now: string): number {
  return record.filter((e) => {
    if (e.button !== "request_renewal" || internalOf(e)?.rxId !== rxId || !within(e.at, now, 7 * DAY_MS)) return false;
    const r = resultOf(e);
    return r?.ok === true;
  }).length;
}

/** Outbound calls allowed for this prescription in the last 3 days (rule 7). */
export function outboundCalls3d(record: RecordEntry[], rxId: string, now: string): number {
  return record.filter((e) => {
    const input = e.input as { check?: string; rx_id?: string } | undefined;
    return e.kind === "safety" && input?.check === "outbound" && input.rx_id === rxId && e.decision === "allowed" && within(e.at, now, 3 * DAY_MS);
  }).length;
}

export type ContextParts = {
  now: string;
  patient: Patient;
  rx: Prescription;
  call?: Call;
  reason?: string;
  record: RecordEntry[];
  policy: { controlledEarlyWindowDays: number };
};

export function buildContext({ now, patient, rx, call, reason, record, policy }: ContextParts): RuleContext {
  const daysSince = daysBetween(rx.lastFill, now);
  return {
    "drug.class": rx.drugClass,
    "drug.controlled": rx.controlled,
    "rx.pct_days_elapsed": Math.round((daysSince / rx.daysSupplied) * 1000) / 10,
    "rx.days_late": Math.max(0, daysSince - rx.daysSupplied),
    "rx.refills_left": rx.refillsLeft,
    "rx.expired": ms(rx.expiry) <= ms(now),
    "rx.days_since_last_fill": daysSince,
    "rx.prescribed_interval_days": rx.prescribedIntervalDays,
    "call.direction": call?.direction ?? "outbound",
    "call.caller_type": call?.state === "verified" ? "patient" : "unverified",
    "call.local_hour": localHour(now),
    "patient.flags": patient.flags,
    "patient.opted_in": patient.optedInToCalls,
    "request.reason_given": typeof reason === "string" && reason.trim().length > 0,
    "recent.blocked_count_10min": blockedCount10min(record, patient.id, now),
    "recent.renewals_7d": renewals7d(record, rx.id, now),
    "recent.outbound_calls_3d": outboundCalls3d(record, rx.id, now),
    "policy.controlled_early_window_days": policy.controlledEarlyWindowDays,
  };
}

/** Convenience: load everything buildContext needs. */
export async function loadContext(store: Store, patient: Patient, rx: Prescription, call?: Call, reason?: string) {
  const [now, record, policy] = await Promise.all([store.now(), store.listRecord(), store.policy()]);
  return buildContext({ now, patient, rx, call, reason, record, policy });
}
