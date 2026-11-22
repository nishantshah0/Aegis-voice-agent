// 4.x (Trail #88), S3 allow-list for dosing instructions. A clause that tells the caller to
// take something ("take", "swallow", "double up") with an amount or a time ("all at once",
// "two", "tonight") is spoken only when it is read off the label. The same holds across
// clauses and across the agent's previous sentence, so "Take them." then "All at once." is
// blocked like "Take them all at once." The dose phrases in doses.ts are still checked too.
import { canonical } from "./doses";
import { words } from "./tokens";

// "take" in lines that aren't about medicine: the verification ask, "Take your time.", notes.
const NOT_DOSING =
  /\btak(?:e|es|ing|en) (?:(?:your|a|the|any|some|a quick|a few|a little|my|down) )?(?:time|name|names|details|look|message|note|notes|seat|moment|minute|minutes|second|seconds|break|call|number|information|info|address|date of birth|care|it from here)\b|\btaken care of\b|\btake care\b/g;
// "Keep taking it as your label says": no amount or time of its own, so nothing to back.
const AS_DIRECTED =
  /\b(?:as|like) (?:directed|prescribed|(?:the|your) label (?:says|said|reads|shows)|it says on (?:the|your) label|on (?:the|your) label|(?:the|your) (?:pharmacist|doctor) (?:said|says|told you|prescribed))\b/;
const VERB = /\b(?:take|takes|taking|taken|swallow\w*|chew\w*|crush\w*|pop|pops|popping|double|doubling|skip|skipping)\b/;
// An amount or a time, on canonical() text (number words are digits, "tablets" is "tablet").
// A bare number counts only with one or two digits, so "call 911" is not an amount.
const AMOUNT =
  /\b\d{1,2}(?:\.\d+)?(?= (?:tablet|capsule|pill|dose|puff|more|extra|of them|at a time|at once)\b| ?$)/;
const TIME_OR_AMOUNT =
  /\b(?:all of them|them all|it all|all at once|at once|at a time|whole|entire|extra|another|double|twice|\d+ times|both|the rest|half|handful|couple|more of them|tonight|tomorrow|every|a day|bedtime|morning|night|evening|hourly|hour)\b/;

// "The label says take 1 tablet ...": a read-back lead, dropped before the clause is matched.
const READ_BACK_LEAD = /^\W*(?:(?:the|your) (?:label|directions|instructions) (?:says?|reads?|shows?|are)|it says)(?: to)?\b/i;

export type DosingClause = "neutral" | "verb" | "amount" | "backed" | "unbacked";

/** What a clause does: tells the caller to take something, gives an amount, both, or neither. */
export function classifyClause(clause: string, backed: (clause: string) => boolean): DosingClause {
  const w = words(clause).replace(NOT_DOSING, " ");
  const c = canonical(w);
  const verb = VERB.test(c);
  const amount = AMOUNT.test(c) || TIME_OR_AMOUNT.test(c);
  if (!amount) return verb && !AS_DIRECTED.test(c) ? "verb" : "neutral";
  if (backed(clause.replace(READ_BACK_LEAD, ""))) return "backed";
  return verb ? "unbacked" : "amount";
}

/**
 * Why the sentence doses off the label, or null. `previous` is the agent's last spoken
 * sentence on the call. `backed` says whether a clause is read off the locked patient's
 * label (or is a supply phrase for its Qty).
 */
export function unbackedDosing(clauses: string[], previous: string[], backed: (clause: string) => boolean): string | null {
  const now = clauses.map((c) => classifyClause(c, backed));
  if (now.includes("unbacked")) return "dosing instruction not on the label";
  const before = previous.map((c) => classifyClause(c, backed));
  const verb = now.includes("verb") || before.includes("verb");
  const amount = now.includes("amount") || before.includes("amount");
  const fromNow = now.includes("verb") || now.includes("amount");
  return verb && amount && fromNow ? "dosing instruction split across clauses, not on the label" : null;
}
