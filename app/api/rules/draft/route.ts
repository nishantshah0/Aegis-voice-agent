import { getApprover, hasRole } from "@/lib/auth/session";
import { writeDraft } from "@/lib/arena/rule-writer";
import { fail, ok, readObject } from "../../_lib/http";
import { getProposer, nextDraftId, saveDraft } from "../../_lib/rule-drafts";
import { getStore } from "../../_lib/runtime";

// POST /api/rules/draft { text } → { draft }   (AUDIT #9, Trail #78; Role 2 and 3 stand-in)
// SPEC "The rule writer", steps 1 to 5: a signed-in pharmacist types a rule; Fable 5.2
// proposes a card, a restatement and three tests; code checks the card (lib/control's
// checkCard), runs the tests and replays the card over past requests. The answer is a
// DRAFT, never live: POST /api/rules/:id/approve is the only way it goes live.
export async function POST(request: Request) {
  const approver = await getApprover();
  if (!approver) return fail(401, "Sign in as a pharmacist to write a rule");
  if (!hasRole(approver, "pharmacist")) return fail(403, "Only a pharmacist can write a rule");

  const text = (await readObject(request))?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 500) return fail(400, "text must be the rule in one or two sentences (up to 500 characters)");

  const propose = getProposer();
  if (!propose) return fail(503, "The rule writer needs ANTHROPIC_API_KEY on the server");

  const store = getStore();
  try {
    const draft = await writeDraft({ id: nextDraftId(await store.listCards()), text: text.trim(), author: approver, store, propose });
    saveDraft(draft);
    return ok({ draft });
  } catch (e) {
    return fail(502, `The rule writer couldn't draft a card: ${e instanceof Error ? e.message : String(e)}`);
  }
}
