import { getApprover } from "@/lib/auth/session";
import { fail, ok, readObject } from "../../_lib/http";
import { patientsOnOpenCalls, ringPatient } from "../../_lib/outbound";
import { getControl, getStore } from "../../_lib/runtime";

// POST /api/outbound/call-now { patientId, rxId } → { callId }
// The Upcoming dashboard's Call now: rings one patient about one prescription now, through
// control.startOutboundCall, so rule 7 (opt-in, calling hours, frequency) still decides.
// Signed-in pharmacists only, or a demo laptop with DEMO_CONTROLS=on.
export async function POST(request: Request) {
  if (process.env.DEMO_CONTROLS !== "on") {
    const approver = await getApprover();
    if (!approver) return fail(401, "Sign in as a pharmacist to call a patient");
    if (approver.role !== "pharmacist") return fail(403, "Only a pharmacist can call a patient");
  }
  const body = await readObject(request);
  const patientId = typeof body?.patientId === "string" ? body.patientId : "";
  const rxId = typeof body?.rxId === "string" ? body.rxId : "";
  if (!patientId || !rxId) return fail(400, "Body must be { patientId, rxId }");

  const store = getStore();
  const rx = await store.getPrescription(rxId);
  if (!(await store.getPatient(patientId)) || !rx || rx.patientId !== patientId) return fail(404, "No such prescription for this patient");
  if ((await patientsOnOpenCalls(store)).has(patientId)) return fail(409, "This patient is already on a call");

  const rang = await ringPatient(getControl(), patientId, rxId);
  if (!rang.ok) return Response.json({ error: `The rules won't ring this patient now (rule ${rang.ruleIds.join(", ")})`, ruleIds: rang.ruleIds }, { status: 409 });
  return ok({ callId: rang.callId });
}
