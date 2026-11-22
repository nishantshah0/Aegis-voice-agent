// Written rule cards (SPEC Part 3, "The rule writer"; AUDIT #9). The rule writer only
// proposes a draft. This lock code decides whether a card is well formed, and is the only
// way a card goes live: a signed-in pharmacist approves it, their name and the time go on it,
// and the change is written to the record. A card can only refuse, route or flag, reads only
// the listed fields, and can never replace a core rule (1, 5), a speech rule or another card.

import { CARD_FIELDS, type Approver, type CardCondition, type CardField, type RuleCard, type Store } from "@/lib/contract";

/** The buttons rule cards are checked on (lib/control/press.ts), plus rule 7's outbound check. */
export const CARD_BUTTONS = ["request_refill", "request_renewal", "set_delivery", "outbound_check"] as const;
export type CardButton = (typeof CARD_BUTTONS)[number];

const OUTCOMES = ["refuse", "route", "flag"] as const;
const OPS = ["=", "!=", "<", "<=", ">", ">=", "in", "contains"] as const;
const NUMERIC_OPS = ["<", "<=", ">", ">="];
/** Core rules are code, and speech rules are S1 to S4: no card may take their ids. */
const RESERVED_ID = /^(1|5|S\d+)$/i;
const ID = /^[A-Za-z0-9-]{1,24}$/;
const MAX_CONDITIONS = 6;

const isField = (v: unknown): v is CardField => typeof v === "string" && (CARD_FIELDS as readonly string[]).includes(v);
const isScalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function checkCondition(c: unknown, i: number): string[] {
  const where = `condition ${i + 1}`;
  if (!c || typeof c !== "object") return [`${where} isn't an object`];
  const { field, op, value } = c as Partial<CardCondition>;
  const errors: string[] = [];
  if (!isField(field)) errors.push(`${where}: "${String(field)}" isn't a field cards may read`);
  if (!OPS.includes(op as (typeof OPS)[number])) errors.push(`${where}: "${String(op)}" isn't an operator`);
  const ref = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as { field?: unknown; minus?: unknown }) : null;
  if (ref) {
    if (!isField(ref.field)) errors.push(`${where}: compares with "${String(ref.field)}", which isn't a field`);
    if (ref.minus !== undefined && typeof ref.minus !== "number" && !isField(ref.minus)) errors.push(`${where}: minus must be a number or a field`);
    if (!NUMERIC_OPS.includes(String(op))) errors.push(`${where}: a field comparison needs <, <=, > or >=`);
  } else if (op === "in") {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" || typeof v === "number")) errors.push(`${where}: "in" needs a list of values`);
  } else if (NUMERIC_OPS.includes(String(op))) {
    if (typeof value !== "number") errors.push(`${where}: "${String(op)}" needs a number`);
  } else if (!isScalar(value)) {
    errors.push(`${where}: the value must be text, a number or true/false`);
  }
  return errors;
}

/** Is this a well-formed, not-yet-approved card that doesn't clash with the live ones? */
export function checkCard(input: unknown, existing: RuleCard[]): { ok: true; card: RuleCard } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object") return { ok: false, errors: ["the card isn't an object"] };
  const card = input as Partial<RuleCard>;
  const errors: string[] = [];
  if (typeof card.id !== "string" || !ID.test(card.id)) errors.push("the id must be 1 to 24 letters, digits or dashes");
  else if (RESERVED_ID.test(card.id)) errors.push(`id ${card.id} belongs to a core or speech rule`);
  else if (existing.some((c) => c.id === card.id)) errors.push(`rule ${card.id} already exists`);
  if (typeof card.wording !== "string" || !card.wording.trim() || card.wording.length > 300) errors.push("the wording must be one sentence of up to 300 characters");
  if (!Array.isArray(card.when) || card.when.length === 0) errors.push("a card needs at least one condition (with none it would match every request)");
  else if (card.when.length > MAX_CONDITIONS) errors.push(`a card has at most ${MAX_CONDITIONS} conditions`);
  else card.when.forEach((c, i) => errors.push(...checkCondition(c, i)));
  if (!OUTCOMES.includes(card.then as (typeof OUTCOMES)[number])) errors.push(`the outcome must be refuse, route or flag, not "${String(card.then)}"`);
  if (
    !Array.isArray(card.appliesTo) ||
    card.appliesTo.length === 0 ||
    new Set(card.appliesTo).size !== card.appliesTo.length ||
    !card.appliesTo.every((b) => (CARD_BUTTONS as readonly string[]).includes(b))
  )
    errors.push(`it must apply to one or more of ${CARD_BUTTONS.join(", ")}`);
  if (card.flagText !== undefined && typeof card.flagText !== "string") errors.push("flagText must be text");
  if (typeof card.risk !== "string" || typeof card.author !== "string") errors.push("risk and author must be text");
  if (!Array.isArray(card.tests) || !card.tests.every((t) => typeof t === "string")) errors.push("tests must be a list of names");
  if (card.live !== false || card.approvedBy !== "" || card.approvedAt !== "") errors.push("a draft can't arrive live or approved");
  return errors.length ? { ok: false, errors } : { ok: true, card: card as RuleCard };
}

/**
 * The only way a written card goes live. Needs a pharmacist (from the Auth0 session, never a
 * request body), re-checks the card against the live cards, stamps the approver and the store's
 * clock, adds it, and records the change.
 */
export async function applyApprovedCard(store: Store, draft: RuleCard, approver: Approver): Promise<{ ok: true; card: RuleCard } | { ok: false; errors: string[] }> {
  if (approver.role !== "pharmacist") return { ok: false, errors: ["only a pharmacist can put a rule live"] };
  const checked = checkCard(draft, await store.listCards());
  if (!checked.ok) return checked;
  const card: RuleCard = { ...structuredClone(checked.card), approvedBy: approver.name, approvedAt: await store.now(), live: true };
  // The card and its rule_change entry are all or nothing (Trail #78, as AUDIT fix 4b for presses):
  // inside store.transaction a failed record write undoes the card, so it never goes live unrecorded.
  const write = async () => {
    await store.addCard(card);
    await store.appendRecord({
      actor: "pharmacist",
      kind: "rule_change",
      input: { change: "add_card", card, approver: { id: approver.id, name: approver.name, role: approver.role } },
      ruleIds: [card.id],
      decision: "allowed",
    });
  };
  await (store.transaction ? store.transaction(write) : write());
  return { ok: true, card };
}
