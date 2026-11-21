import type { CallId, Patient, Prescription, RuleId, RunDailyCheckResponse, Store } from "@/lib/contract";
import { evaluate, loadContext } from "@/lib/control";
import { emit } from "@/lib/events";
import { PHARMACY_NAME } from "@/lib/seed";
import { demoControlsRefused } from "../../_lib/demo";
import { recordRing } from "../../_lib/devices";
import { ok } from "../../_lib/http";
import { getControl, getStore } from "../../_lib/runtime";

// POST /api/outbound/run-daily-check → { callIds, skipped }
// SPEC "The call, outbound", step 1: ring opted-in patients whose supply runs out
// within 3 days and whose refill would pass the refill rules (3, 4b and the rest) today.
// Due-soon is checked here; the refill rules are the control layer's own engine, read
// only; then control.startOutboundCall applies rule 7's cards (opt-in, hours, frequency).
// One call per patient; nobody is rung again while their last call is still open.

const DUE_WITHIN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Why not to ring about this prescription today, as rule ids, or null if it's due and would pass. */
async function notDueReason(store: Store, patient: Patient, rx: Prescription): Promise<RuleId[] | null> {
  const now = Date.parse(await store.now());
  const daysLeft = rx.daysSupplied - Math.floor((now - Date.parse(rx.lastFill)) / DAY_MS);
  if (daysLeft > DUE_WITHIN_DAYS) return ["7"];
  const verdict = evaluate(await store.listCards(), "request_refill", await loadContext(store, patient, rx));
  return verdict.outcome === "refuse" ? verdict.deciding : null;
}

async function patientsOnOpenCalls(store: Store): Promise<Set<string>> {
  const starts = (await store.listRecord()).filter(
    (e) => e.kind === "safety" && (e.input as { check?: string; direction?: string })?.direction === "outbound" && e.callId,
  );
  const calls = await Promise.all(starts.map((e) => store.getCall(e.callId as CallId)));
  return new Set(calls.filter((c) => c && c.state !== "ended" && c.targetPatientId).map((c) => c!.targetPatientId!));
}

export async function POST() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const store = getStore();
  const control = getControl();
  const busy = await patientsOnOpenCalls(store);
  const res: RunDailyCheckResponse = { callIds: [], skipped: [] };

  for (const patient of await store.listPatients()) {
    if (busy.has(patient.id)) continue;
    for (const rx of await store.getPrescriptions(patient.id)) {
      const reason = await notDueReason(store, patient, rx);
      if (reason) {
        res.skipped.push({ patientId: patient.id, ruleIds: reason });
        continue;
      }
      const started = await control.startOutboundCall(patient.id, rx.id);
      if (!started.ok) {
        res.skipped.push({ patientId: patient.id, ruleIds: started.ruleIds });
        continue;
      }
      res.callIds.push(started.callId);
      recordRing(started.callId, patient.id);
      emit({ type: "phone", callId: started.callId, kind: "ring", text: `${PHARMACY_NAME} is calling` });
      break;
    }
  }
  return ok(res);
}
