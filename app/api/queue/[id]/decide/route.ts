import { getApprover, hasRole } from "@/lib/auth/session";
import type { DecideResponse } from "@/lib/contract";
import { emit } from "@/lib/events";
import { fail, ok, readObject } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

async function phoneStatus(orderId: string, decision: "approve" | "deny"): Promise<string> {
  if (decision === "deny") return "Not approved. The pharmacy will be in touch.";
  const store = getStore();
  const order = (await store.listOrders()).find((o) => o.id === orderId);
  const slot = order?.slotId ? (await store.listSlots()).find((s) => s.id === order.slotId) : undefined;
  return slot ? `Approved, ${slot.label}` : "Approved by the pharmacist";
}

// POST /api/queue/:id/decide { decision: "approve" | "deny", note? } → { item }
// Needs a signed-in pharmacist. The approver always comes from the Auth0
// session, never from the body.
export async function POST(request: Request, ctx: RouteContext<"/api/queue/[id]/decide">) {
  const { id } = await ctx.params;
  const approver = await getApprover();
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

  let item;
  try {
    item = await store.decide(id, decision, approver, note);
  } catch (error) {
    // 409 only if another approval of the same item really won the race after the check
    // above; any other store failure is a real error.
    const now = (await store.queue()).find((q) => q.id === id);
    if (now && now.status !== "open") return fail(409, `Already ${now.status}`);
    throw error;
  }
  emit({ type: "queue", item });
  // The patient's phone hears the outcome of anything with an order behind it.
  if (item.orderId) emit({ type: "phone", callId: item.callId, kind: "status", text: await phoneStatus(item.orderId, decision) });
  const res: DecideResponse = { item };
  return ok(res);
}
