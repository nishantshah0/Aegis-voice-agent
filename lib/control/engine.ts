// The rule-card engine (SPEC Part 3, "How a decision is made"). Pure: no store, no clock.
// Strictest wins: refuse > route > flag > allowed. A card with any other outcome is
// treated as broken and refuses, so no card can ever loosen anything.

import type { ButtonName, CardCondition, CardOutcome, CardValue, RuleCard, RuleContext, RuleId } from "@/lib/contract";

export type Outcome = CardOutcome | "allowed";

const RANK: Record<Outcome, number> = { allowed: 0, flag: 1, route: 2, refuse: 3 };

export const stricter = (a: Outcome, b: Outcome): Outcome => (RANK[a] >= RANK[b] ? a : b);

export type CardMatch = { id: RuleId; then: CardOutcome; flagText?: string };

export type Verdict = {
  outcome: Outcome;
  /** Every card that matched, in card order. */
  matched: CardMatch[];
  /** The ids of the cards that decided the outcome (those at the strictest level). */
  deciding: RuleId[];
};

function resolve(value: CardCondition["value"], ctx: RuleContext): CardValue | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const base = ctx[value.field];
    if (typeof base !== "number") return undefined;
    if (value.minus === undefined) return base;
    const minus = typeof value.minus === "number" ? value.minus : ctx[value.minus];
    return typeof minus === "number" ? base - minus : undefined;
  }
  return value;
}

/** True when the context lacks a field this condition reads (its value's field and minus included). */
export function readsMissing(cond: CardCondition, ctx: RuleContext): boolean {
  const v = cond.value;
  const fields = v !== null && typeof v === "object" && !Array.isArray(v) ? [cond.field, v.field, ...(typeof v.minus === "string" ? [v.minus] : [])] : [cond.field];
  return fields.some((f) => ctx[f] === undefined);
}

/** One condition. A field the context doesn't have never matches here; see evaluate for cards. */
export function holds(cond: CardCondition, ctx: RuleContext): boolean {
  const actual = ctx[cond.field];
  const expected = resolve(cond.value, ctx);
  if (actual === undefined || expected === undefined) return false;
  switch (cond.op) {
    case "=":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case "<":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "<=":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case ">":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case ">=":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "in":
      return Array.isArray(expected) && (typeof actual === "string" || typeof actual === "number") && expected.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return (typeof expected === "string" || typeof expected === "number") && actual.includes(expected);
      return typeof actual === "string" && typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

const VALID_OUTCOMES: readonly string[] = ["refuse", "route", "flag"];

/** Run every live card that applies to `button` against the context. */
export function evaluate(cards: RuleCard[], button: ButtonName | "outbound_check", ctx: RuleContext): Verdict {
  const matched: CardMatch[] = [];
  for (const card of cards) {
    if (!card.live || !card.appliesTo.includes(button)) continue;
    if (card.when.length === 0) continue;
    const then: CardOutcome = VALID_OUTCOMES.includes(card.then) ? card.then : "refuse";
    // Fail closed: a refuse or route card whose field is missing from the context counts that
    // condition as holding, so a gap in the context can't switch a rule off. Flags can skip.
    const failClosed = then !== "flag";
    if (!card.when.every((cond) => holds(cond, ctx) || (failClosed && readsMissing(cond, ctx)))) continue;
    matched.push({ id: card.id, then, flagText: card.flagText });
  }
  const outcome = matched.reduce<Outcome>((acc, m) => stricter(acc, m.then), "allowed");
  const deciding = matched.filter((m) => m.then === outcome).map((m) => m.id);
  return { outcome, matched, deciding };
}
