import type { CallId, RunDailyCheckResponse, Store } from "@/lib/contract";
import { emit } from "@/lib/events";
import { PHARMACY_NAME } from "@/lib/seed";
import { demoControlsRefused } from "../../_lib/demo";
import { ok } from "../../_lib/http";
import { getControl, getStore } from "../../_lib/runtime";

// POST /api/outbound/run-daily-check → { callIds, skipped }
// At the demo clock's time, asks the control layer about every prescription. Rule 7
// (and the cards it runs) decides who may be rung; this route never decides that.
// One call per patient; nobody is rung again while their last call is still open.

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
      const started = await control.startOutboundCall(patient.id, rx.id);
      if (!started.ok) {
        res.skipped.push({ patientId: patient.id, ruleIds: started.ruleIds });
        continue;
      }
      res.callIds.push(started.callId);
      emit({ type: "phone", callId: started.callId, kind: "ring", text: `${PHARMACY_NAME} is calling` });
      break;
    }
  }
  return ok(res);
}
