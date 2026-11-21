// Triage lanes (SPEC Part 3, "Triage"). Chosen in code from rules and signals, never by the AI.

import type { Lane, RuleId, Signal } from "@/lib/contract";
import type { Verdict } from "./engine";

/** Cards that need a person only because of the law or policy, not because anything is unusual. */
export const POLICY_ONLY_CARDS: readonly RuleId[] = ["4"];

/** Signals that come straight from matched cards. */
const CARD_SIGNALS: Record<RuleId, Signal> = { "3": "early", "6": "missed_doses", "11": "attack_alarm" };

export function signalsFromCards(verdict: Verdict): Signal[] {
  return verdict.matched.flatMap((m) => (CARD_SIGNALS[m.id] ? [CARD_SIGNALS[m.id]] : []));
}

/**
 * Automatic: nothing matched and every signal is normal.
 * Quick check: the only cards that matched are policy-only (a controlled drug on schedule), no signals.
 * Review: anything else.
 */
export function chooseLane(verdict: Verdict, signals: Signal[]): Lane {
  if (signals.length > 0) return "review";
  if (verdict.matched.length === 0) return "automatic";
  if (verdict.matched.every((m) => POLICY_ONLY_CARDS.includes(m.id))) return "quick_check";
  return "review";
}
