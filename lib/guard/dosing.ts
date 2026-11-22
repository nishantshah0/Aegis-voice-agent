// 4.x (Trail #88), S3 allow-list for dosing instructions. A clause that tells the caller to
// take something ("take", "swallow", "double up") with an amount or a time ("all at once",
// "two", "tonight") is spoken only when it is read off the label. The same holds across
// clauses and across the agent's previous sentence, so "Take them." then "All at once." is
// blocked like "Take them all at once." The dose phrases in doses.ts are still checked too.
import { canonical } from "./doses";
import { words } from "./tokens";

// "take" in lines that aren't about medicine: the verification ask, "Take your time.", notes.
const NOT_DOSING =
  /\btak(?:e|es|ing|en) (?:(?:your|a|the|any|some|a quick|a few|a little|my|down) )?(?:time|name|names|details|look|message|note|notes|seat|moment|minute|minutes|second|seconds|break|call|number|information|info|address|date of birth|care|it from here)\b|\btaken care of\b|\btake care\b|\b(?:it|that|this|which|delivery|shipping|the order|the refill|itll|it ll|thatll|that ll)(?: s| is| will| would| should| can| could| might| may| usually| normally| typically)? (?:take|takes|taking)\b/g;
// "Keep taking it as your label says": no amount or time of its own, so nothing to back.
const AS_DIRECTED =
  /\b(?:as|like) (?:directed|prescribed|(?:the|your) label (?:says|said|reads|shows)|it says on (?:the|your) label|on (?:the|your) label|(?:the|your) (?:pharmacist|doctor) (?:said|says|told you|prescribed))\b/;
// Also "make it two", "finish them", and the same verbs in the languages callers try.
const VERB =
  /\b(?:take|taking|taken|swallow\w*|chew\w*|crush\w*|pop|pops|popping|double|doubling|triple|tripling|skip|skipping|make it|finish\w*|use up|prenez|prends|prendre|tome|tomar|toma|tomen|nehmen|nimm|prendi|prenda|lijiye|khaiye|khao|le lo)\b/;
// An amount or a time, on canonical() text (number words are digits, "tablets" is "tablet").
// A bare number counts only with one or two digits, so "call 911" is not an amount.
const AMOUNT =
  /\b\d{1,2}(?:\.\d+)?(?= (?:tablet|capsule|pill|dose|puff|more|extra|of them|at a time|at once)\b| ?$)/;
const TIME_OR_AMOUNT =
  /\b(?:all of them|them all|it all|all at once|at once|at a time|whole|entire|extra|another|double|twice|\d+ times|both|the rest|half|handful|couple|more of them|tonight|tomorrow|every|a day|bedtime|morning|night|evening|hourly|hour|a second (?:one|dose|tablet|pill|capsule)|another one|at noon|at lunch|at lunchtime|midday|at dinner|at dinnertime|at supper|ce soir|toutes les|esta noche|cada|stasera|auf einmal|jeden|aaj raat|har)\b/;
// Amounts and times that are only a dose beside the verb: "take two today", "swallow 30
// together", "take as many as you need". On their own ("refilled today", "anything more?") they
// are ordinary words.
const WITH_VERB =
  /\b(?:\d+|today|now|together|in one go|at the same time|in one sitting|at lunch|at noon|again|whenever|as many|as much|as needed|more|the lot|a few|several|full|all of it|x ?\d+|comprimes?|pastillas|tabletas|tabletten|compresse|goliyan)\b/;

// "The label says take 1 tablet ...": a read-back lead, dropped before the clause is matched.
const READ_BACK_LEAD = /^\W*(?:(?:the|your) (?:label|directions|instructions) (?:says?|reads?|shows?|are)|it says)(?: to)?\b/i;

// How long something takes is not a dose (code reviewer, MEDIUM): "about 10 minutes", "a couple
// of days", "up to 2 days", "a while". Never "every 4 hours" or "a day", which are frequencies.
const DURATION =
  /\b(?:(?:for|in|within|about|around|roughly|up to|over) )?(?<!every )(?:(?:\d+|a couple of|couple of|a few|few|several) (?:minute|hour|day|week|month)s?|(?:a|an) (?:minute|hour|week|month)s?)\b|\ba while\b/g;

export type DosingClause = "neutral" | "verb" | "amount" | "backed" | "backed_verb" | "unbacked";

/** What a clause does: tells the caller to take something, gives an amount, both, or neither. */
export function classifyClause(clause: string, backed: (clause: string) => boolean): DosingClause {
  const w = words(clause).replace(NOT_DOSING, " ");
  const c = canonical(w).replace(DURATION, " ");
  const verb = VERB.test(c);
  const amount = AMOUNT.test(c) || TIME_OR_AMOUNT.test(c) || (verb && WITH_VERB.test(c));
  if (!amount) return verb && !AS_DIRECTED.test(c) ? "verb" : "neutral";
  // A label read-back with its verb ("Take 1 tablet every morning") still tells the caller to
  // take it, so an amount beside it ("and another at lunch") is a dose too.
  if (backed(clause.replace(READ_BACK_LEAD, ""))) return verb ? "backed_verb" : "backed";
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
  const verb = [...now, ...before].some((k) => k === "verb" || k === "backed_verb");
  const amount = now.includes("amount") || before.includes("amount");
  const fromNow = now.includes("verb") || now.includes("amount");
  return verb && amount && fromNow ? "dosing instruction split across clauses, not on the label" : null;
}
