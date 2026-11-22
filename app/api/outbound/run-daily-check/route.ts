import type { RunDailyCheckResponse } from "@/lib/contract";
import { demoControlsRefused } from "../../_lib/demo";
import { ok } from "../../_lib/http";
import { notDueReason, patientsOnOpenCalls, ringPatient } from "../../_lib/outbound";
import { getControl, getStore } from "../../_lib/runtime";

// POST /api/outbound/run-daily-check → { callIds, skipped }
// SPEC "The call, outbound", step 1: ring opted-in patients whose supply runs out
// within 3 days and whose refill would pass the refill rules (3, 4b and the rest) today.
// Due-soon is checked here; the refill rules are the control layer's own engine, read
// only; then control.startOutboundCall applies rule 7's cards (opt-in, hours, frequency).
// One call per patient; nobody is rung again while their last call is still open.

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
      const rang = await ringPatient(control, patient.id, rx.id);
      if (!rang.ok) {
        res.skipped.push({ patientId: patient.id, ruleIds: rang.ruleIds });
        continue;
      }
      res.callIds.push(rang.callId);
      break;
    }
  }
  return ok(res);
}
