import { getApprover, hasRole } from "@/lib/auth/session";
import type { DecideResponse } from "@/lib/contract";
import { emit } from "@/lib/events";
import { fail, ok, readObject } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

// POST /api/queue/:id/decide { decision: "approve" | "deny", note? } → { item }
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

  const store = getStore();
  const existing = (await store.queue()).find((q) => q.id === id);
  if (!existing) return fail(404, "No such queue item");
  if (existing.status !== "open") return fail(409, `Already ${existing.status}`);

  const item = await store.decide(id, decision, approver, note);
  emit({ type: "queue", item });
  const res: DecideResponse = { item };
  return ok(res);
}
