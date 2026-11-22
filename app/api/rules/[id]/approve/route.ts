import { getApprover, hasRole } from "@/lib/auth/session";
import { applyApprovedCard } from "@/lib/control";
import { fail, ok } from "../../../_lib/http";
import { getDraft, markApproved } from "../../../_lib/rule-drafts";
import { getStore } from "../../../_lib/runtime";

// POST /api/rules/:id/approve → { card }   (AUDIT #9, Trail #78; Role 2 and 3 stand-in)
// SPEC "The rule writer", step 7: a signed-in pharmacist approves a draft whose card passed
// the lock's check and whose three tests all passed. The approver comes from the Auth0
// session, never the body. lib/control's applyApprovedCard re-checks the card, stamps the
// name and time, adds it to the live cards and writes a rule_change entry to the record.
export async function POST(_request: Request, ctx: RouteContext<"/api/rules/[id]/approve">) {
  const { id } = await ctx.params;
  const approver = await getApprover();
  if (!approver) return fail(401, "Sign in as a pharmacist to approve a rule");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can put a rule live");

  const state = getDraft(id);
  if (!state) return fail(404, `No draft ${id}`);
  if (state.status === "approved") return fail(409, `Rule ${id} is already live`);
  if (!state.draft.ready) return fail(409, `Draft ${id} isn't ready: ${state.draft.problems.join("; ")}`);

  const applied = await applyApprovedCard(getStore(), state.draft.card, approver);
  if (!applied.ok) return fail(409, applied.errors.join("; "));
  markApproved(id);
  return ok({ card: applied.card });
}
