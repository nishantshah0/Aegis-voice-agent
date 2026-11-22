import type { Call, CallId, Patient, Prescription, Store } from "@/lib/contract";
import { DUE_WITHIN_DAYS, daysLeft, outboundPreview, refillPreview, type Preview } from "@/app/api/_lib/outbound";

// 2.9a: what the pharmacist sees coming. Every prescription whose supply runs out within
// 14 days, with the lane its refill would land in today (the rule cards run read-only:
// nothing is pressed and nothing is written to the record), the patient's last call and
// when the daily check would next ring them.

export const WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UpcomingRow = {
  patientId: string;
  rxId: string;
  initials: string;
  drug: string;
  controlled: boolean;
  daysLeft: number;
  /** YYYY-MM-DD on the pharmacy's calendar. */
  runOut: string;
  preview: Preview;
  lastCall?: { callId: CallId; direction: Call["direction"]; state: Call["state"]; startedAt: string };
  /** "today", a YYYY-MM-DD date, "not opted in", or why the rules won't ring. */
  nextReminder: string;
};

export type Upcoming = { today: string; rows: UpcomingRow[]; days: { date: string; count: number }[] };

/** A date (YYYY-MM-DD) plus whole days. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

async function lastCalls(store: Store): Promise<Map<string, NonNullable<UpcomingRow["lastCall"]>>> {
  const starts = (await store.listRecord()).filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start" && e.callId);
  const latest = new Map<string, NonNullable<UpcomingRow["lastCall"]>>();
  for (const entry of starts) {
    const call = await store.getCall(entry.callId as CallId);
    const patientId = call?.targetPatientId ?? call?.lockedPatientId;
    if (call && patientId) latest.set(patientId, { callId: call.id, direction: call.direction, state: call.state, startedAt: call.startedAt });
  }
  return latest;
}

async function nextReminder(store: Store, patient: Patient, rx: Prescription, preview: Preview, left: number, runOut: string): Promise<string> {
  if (!patient.optedInToCalls) return "not opted in";
  if (preview.kind === "refused") return `won't ring: rule ${preview.ruleIds.join(", ")}`;
  if (left > DUE_WITHIN_DAYS) return addDays(runOut, -DUE_WITHIN_DAYS);
  // Due now: "today" only if rule 7 would let the daily check ring (audit fix 14).
  const outbound = await outboundPreview(store, patient, rx);
  return outbound.allowed ? "today" : `won't ring today: rule ${outbound.ruleIds.join(", ") || "7"}`;
}

export async function upcoming(store: Store): Promise<Upcoming> {
  const now = await store.now();
  const today = now.slice(0, 10);
  const calls = await lastCalls(store);
  const rows: UpcomingRow[] = [];

  for (const patient of await store.listPatients()) {
    for (const rx of await store.getPrescriptions(patient.id)) {
      const left = daysLeft(rx, now);
      if (left > WINDOW_DAYS) continue;
      const preview = await refillPreview(store, patient, rx);
      const runOut = addDays(today, left);
      rows.push({
        patientId: patient.id,
        rxId: rx.id,
        initials: `${patient.firstName[0]}.${patient.lastName[0]}.`,
        drug: `${rx.drug} ${rx.strength}`,
        controlled: rx.controlled,
        daysLeft: left,
        runOut,
        preview,
        lastCall: calls.get(patient.id),
        nextReminder: await nextReminder(store, patient, rx, preview, left, runOut),
      });
    }
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft);
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => ({ date: addDays(today, i), count: rows.filter((r) => r.daysLeft === i).length }));
  return { today, rows, days };
}
