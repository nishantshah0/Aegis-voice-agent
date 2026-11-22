// Days supply and quantity (Trail #85). The quantity for a supply is worked out here from the
// label, never taken from the model: units per dose × doses per day × days. It must agree
// with the label's own Qty over the prescribed days, or there is no quantity (and a partial
// fill can't be done by phone).

import type { Prescription } from "@/lib/contract";

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

const FREQUENCIES: [RegExp, number][] = [
  [/\b(?:once (?:a day|daily)|every (?:morning|evening|night)|at bedtime)\b/, 1],
  [/\b(?:twice (?:a day|daily)|two times (?:a day|daily))\b/, 2],
  [/\bthree times (?:a day|daily)\b/, 3],
  [/\bfour times (?:a day|daily)\b/, 4],
];

/** The label's printed Qty, e.g. 30 from "Qty 30.". */
export function labelQty(label: string): number | undefined {
  const n = Number(label.match(/\bqty\.? ?(\d+)\b/i)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** "tablet" or "capsule", from the label. */
export function labelUnit(label: string): string {
  return label.match(/\b(tablet|capsule)s?\b/i)?.[1]?.toLowerCase() ?? "unit";
}

/**
 * Units a day from the label's own directions ("Take 1 tablet by mouth twice a day" → 2), or
 * undefined when the directions don't say it plainly: no dose, a half dose, "as needed", or
 * more than one frequency.
 */
export function unitsPerDay(label: string): number | undefined {
  const t = label.toLowerCase();
  if (/\bas needed\b|\bprn\b|\bhalf\b|\bevery \d+ hours?\b/.test(t)) return undefined;
  const dose = t.match(/\btake (\d+|one|two|three|four) (?:tablet|capsule)s?\b/);
  if (!dose) return undefined;
  const perDose = /^\d+$/.test(dose[1]) ? Number(dose[1]) : NUMBER_WORDS[dose[1]];
  const found = FREQUENCIES.filter(([re]) => re.test(t));
  if (found.length !== 1 || !perDose) return undefined;
  return perDose * found[0][1];
}

/** Units for `days` of this prescription, or undefined when the label can't say it for sure. */
export function quantityFor(rx: Prescription, days: number): number | undefined {
  const perDay = unitsPerDay(rx.labelText);
  const qty = labelQty(rx.labelText);
  if (!perDay || !qty) return undefined;
  // The label's directions must agree with its own Qty over the prescribed days.
  if (perDay * rx.daysSupplied !== qty) return undefined;
  return perDay * days;
}

/** The longest supply a refill may be: what was prescribed. */
export const MAX_DAYS_SUPPLY = 365;
