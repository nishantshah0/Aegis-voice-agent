import type { RuleCard } from "@/lib/contract";
import { claudeProposer, type Proposer, type RuleDraft } from "@/lib/arena/rule-writer";

// Rule-writer drafts (AUDIT #9, Trail #78), kept in this server process until approved. A
// draft is never live: only POST /api/rules/:id/approve, through lib/control's
// applyApprovedCard, adds a card to the store. Drafts are lost on restart, which is safe.

type DraftState = { draft: RuleDraft; status: "draft" | "approved" };
type Holder = { drafts: Map<string, DraftState>; n: number; proposer: Proposer | null };

const holder = globalThis as typeof globalThis & { __ruleDrafts?: Holder };
const state = (): Holder => (holder.__ruleDrafts ??= { drafts: new Map(), n: 0, proposer: null });

/** The next free written-card id (w1, w2, ...), unused by live cards and other drafts. */
export function nextDraftId(cards: RuleCard[]): string {
  const s = state();
  let id: string;
  do id = `w${++s.n}`;
  while (cards.some((c) => c.id === id) || s.drafts.has(id));
  return id;
}

export const saveDraft = (draft: RuleDraft) => state().drafts.set(draft.id, { draft, status: "draft" });
export const getDraft = (id: string): DraftState | undefined => state().drafts.get(id);
export function markApproved(id: string) {
  const d = state().drafts.get(id);
  if (d) d.status = "approved";
}
export const listDrafts = (): DraftState[] => [...state().drafts.values()].reverse();

/** Fable 5.2 when the server has a key; null means the rule writer can't run here. */
export function getProposer(): Proposer | null {
  const override = state().proposer;
  if (override) return override;
  return process.env.ANTHROPIC_API_KEY ? claudeProposer() : null;
}

export function setProposerForTests(proposer: Proposer | null) {
  state().proposer = proposer;
}

export function resetDraftsForTests() {
  holder.__ruleDrafts = { drafts: new Map(), n: 0, proposer: null };
}
