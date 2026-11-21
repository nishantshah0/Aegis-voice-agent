import { getApprover, hasRole } from "@/lib/auth/session";
import { fail, notBuilt, readObject } from "../../../_lib/http";

// POST /api/queue/:id/decide { decision: "approve" | "deny", note? }
// Needs a signed-in pharmacist. The approver always comes from the Auth0
// session, never from the body. Until task 2.4, nobody is signed in, so this
// always answers 401.
export async function POST(request: Request, ctx: RouteContext<"/api/queue/[id]/decide">) {
  const { id } = await ctx.params;
  const approver = await getApprover(request);
  if (!approver) return fail(401, "Sign in as a pharmacist to decide");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can decide");

  const body = await readObject(request);
  const decision = body?.decision;
  const note = body?.note;
  if (decision !== "approve" && decision !== "deny") {
    return fail(400, 'decision must be "approve" or "deny"');
  }
  if (note !== undefined && typeof note !== "string") return fail(400, "note must be a string when given");

  void id; // store.decide(id, decision, approver, note) once task 4.2's store lands.
  return notBuilt("store.decide waits on task 4.2 (store) and 2.4 (Auth0)");
}
