import { getApprover, hasRole } from "@/lib/auth/session";
import { clearPatientCodeLock } from "@/lib/control";
import { fail, ok } from "../../../../_lib/http";
import { getStore } from "../../../../_lib/runtime";

// POST /api/patients/:id/code-lock/clear → { ok: true, at }   (Trail #86, Role 2 stand-in)
// A signed-in pharmacist clears a patient's code lockout early. No body: the approver comes
// from the Auth0 or presenter session (getApprover), never the request, and cross-origin POSTs
// are refused by the proxy. lib/control's clearPatientCodeLock writes one pharmacist approval
// entry (input.change "clear_code_lock"); it approves nothing else. Read the lock with
// patientCodeLock(store, patientId) server-side.
export async function POST(_request: Request, ctx: RouteContext<"/api/patients/[id]/code-lock/clear">) {
  const { id } = await ctx.params;
  const approver = await getApprover();
  if (!approver) return fail(401, "Sign in as a pharmacist to clear a lockout");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can clear a lockout");
  const store = getStore();
  if (!(await store.getPatient(id))) return fail(404, "No such patient");
  const cleared = await clearPatientCodeLock(store, id, approver);
  if (!cleared.ok) return fail(400, cleared.error);
  return ok(cleared);
}
