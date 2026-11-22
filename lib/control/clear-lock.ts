// A patient's code lockout (Trail #86), and the pharmacist's way to clear it early. The lock is
// worked out from the record: wrong codes against the patient on any call, counted from their
// latest clear. Clearing is not a button, so the AI can never unlock anyone: like a rule card's
// approval it needs a signed-in pharmacist (from the Auth0 session, never a request body), and it
// is written to the record, which is all the lock reads.

import type { Approver, RecordEntry, Store } from "@/lib/contract";
import { internalOf } from "./context";
import { MINUTE_MS } from "./time";

/**
 * Wrong codes against one patient, on any calls, that lock that patient: three in 15 minutes lock
 * 15 minutes from the third; six in 24 hours lock 2 hours from the sixth, and each later wrong
 * code that day locks 2 hours again, so two guesses a call spaced past the 15-minute lock can't
 * add up. Two hours, not 24, so someone who knows a patient's details can't lock them out for a
 * day (the top session's call); a pharmacist can clear it sooner.
 */
export const PATIENT_CODE_LOCKS = [
  { wrong: 3, withinMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  { wrong: 6, withinMs: 24 * 60 * MINUTE_MS, lockMs: 2 * 60 * MINUTE_MS },
] as const;

export const isLockClear = (e: RecordEntry, patientId: string) =>
  e.kind === "approval" && e.actor === "pharmacist" && (e.input as { change?: string; patientId?: string } | undefined)?.change === "clear_code_lock" && (e.input as { patientId?: string }).patientId === patientId;

/** When each wrong code against this patient was entered since their latest clear, oldest first. */
export function codeFailuresSinceClear(record: RecordEntry[], patientId: string): string[] {
  let from = 0;
  record.forEach((e, i) => {
    if (isLockClear(e, patientId)) from = i + 1;
  });
  return record
    .slice(from)
    .filter((e) => e.button === "check_code" && internalOf(e)?.codeFailed && internalOf(e)?.patientId === patientId)
    .map((e) => e.at);
}

/** The end of the patient's lock, if one holds at `now`. A clock moved back never ends it early. */
export function lockedUntilFrom(failures: string[], now: string): string | undefined {
  let until: number | undefined;
  for (const rule of PATIENT_CODE_LOCKS) {
    for (let i = rule.wrong - 1; i < failures.length; i++) {
      if (Date.parse(failures[i]) - Date.parse(failures[i - (rule.wrong - 1)]) <= rule.withinMs) {
        until = Math.max(until ?? 0, Date.parse(failures[i]) + rule.lockMs);
      }
    }
  }
  return until !== undefined && until > Date.parse(now) ? new Date(until).toISOString() : undefined;
}

/** For the console: is this patient locked out, and until when? */
export async function patientCodeLock(store: Store, patientId: string): Promise<{ lockedUntil: string | undefined }> {
  const [record, now] = await Promise.all([store.listRecord(), store.now()]);
  return { lockedUntil: lockedUntilFrom(codeFailuresSinceClear(record, patientId), now) };
}

/**
 * A pharmacist clears the patient's code lockout. Wrong codes before it no longer count; the
 * hour's failed-code triage signal and any per-call lock stay. Writes one record entry.
 */
export async function clearPatientCodeLock(store: Store, patientId: string, approver: Approver): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  if (approver.role !== "pharmacist") return { ok: false, error: "only a pharmacist can clear a lockout" };
  if (!(await store.getPatient(patientId))) return { ok: false, error: "no such patient" };
  const entry = await store.appendRecord({
    actor: "pharmacist",
    kind: "approval",
    input: { change: "clear_code_lock", patientId, approver: { id: approver.id, name: approver.name, role: approver.role } },
    output: { status: "cleared", was_locked_until: (await patientCodeLock(store, patientId)).lockedUntil ?? null },
    decision: "allowed",
  });
  return { ok: true, at: entry.at };
}
