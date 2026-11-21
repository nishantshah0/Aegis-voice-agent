import { getApprover, hasRole } from "@/lib/auth/session";
import type { DecideResponse, QueueItem } from "@/lib/contract";
import { argsDigest } from "@cygnuxlabs/tracekit/v2";
import { createTracekitRuntime, type SignerRun } from "@/lib/audit/signed-press";
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

  let run: SignerRun | undefined;
  let toolCallId: string | undefined;
  let committed = false;
  const tracekit = createTracekitRuntime();
  let item: QueueItem;
  try {
    run = await tracekit.registerRun("aegis-pharmacist-decision", `decision-${crypto.randomUUID()}`);
    toolCallId = `queue:${id}:${crypto.randomUUID()}`;
    const policyDecision = await run.decide(toolCallId, "pharmacist_decision", {
      queue_item: id,
      order: existing.orderId ?? null,
      decision,
      approver_commitment: argsDigest("aegis.approver", { subject: approver.id }),
    }, { tool_class_hint: "app" });
    if (policyDecision.unavailable || policyDecision.decision !== "allow" || !policyDecision.decision_id) {
      await run.complete(toolCallId, "error", { result_digest: argsDigest("aegis.pharmacist.decision", { outcome: "blocked" }) });
      return fail(403, "The signed policy did not authorize this pharmacist decision");
    }
    item = await store.decide(id, decision, approver, note, {
      runId: run.runId,
      decisionId: policyDecision.decision_id,
      ruleIds: Array.isArray(policyDecision.rule_ids) ? policyDecision.rule_ids : [],
    });
    committed = true;
    const completion = await run.complete(toolCallId, "ok", {
      result_digest: argsDigest("aegis.pharmacist.decision.result", {
        queue_item: item.id,
        status: item.status,
        order: item.orderId ?? null,
        decision_record: (await store.listRecord(item.callId)).find((entry) => entry.kind === "approval" && (entry.input as { itemId?: string })?.itemId === item.id)?.hash ?? null,
      }),
    });
    if (!completion) return fail(503, "Decision committed, but the signer did not record its result; refresh before retrying");
  } catch (error) {
    if (committed) return fail(503, "Decision committed, but signing its result failed; refresh the console before retrying");
    // 409 only if another approval of the same item really won the race after the check
    // above; any other store failure is a real error.
    const now = (await store.queue()).find((q) => q.id === id);
    if (now && now.status !== "open") {
      if (run && toolCallId) await run.complete(toolCallId, "error", { result_digest: argsDigest("aegis.pharmacist.decision.conflict", { queue_item: id, status: now.status }) }).catch(() => null);
      return fail(409, `Already ${now.status}`);
    }
    await tracekit.close().catch(() => undefined);
    throw error;
  } finally {
    await run?.close("pharmacist decision complete").catch(() => undefined);
    await tracekit.close().catch(() => undefined);
  }
  emit({ type: "queue", item });
  // The patient's phone hears the outcome of anything with an order behind it.
  if (item.orderId) emit({ type: "phone", callId: item.callId, kind: "status", text: await phoneStatus(item.orderId, decision) });
  const res: DecideResponse = { item };
  return ok(res);
}
