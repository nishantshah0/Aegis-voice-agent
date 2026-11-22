// The speech guard (SPEC Part 3, "Speech rules"). Every sentence the agent would say
// passes through guardSentence before speech. Pure code: it holds with the hijack on.
//   S1 before verification: nothing from the records the caller hasn't said
//   S2 after verification: nothing of another patient's the caller hasn't said
//   S3 every dose, frequency or quantity is on the locked patient's label or record
//   S4 every promise matches the record (approved, sent, booked, a price, a day)

import { GUARD_REPLACEMENTS, type Call, type EmitFn, type GuardResult, type GuardSentenceFn, type RecordEntry, type SpeechRule, type Store } from "@/lib/contract";
import { internalOf, resultOf } from "@/lib/control/context";
import { canonical, unbackedDoses, wordsToNumber } from "./doses";
import { classifyClause, unbackedDosing } from "./dosing";
import { digitText, hearableForms, UNREADABLE, withoutPossessives } from "./normalize";
import { isRecordedReadback, ungroundedPatientFact } from "./patient-facts";
import { digitsOf, mentions, tokensFor, words, type Token } from "./tokens";

export const S4_REPLACEMENT = "A pharmacist will check it first, and I'll confirm once it's approved.";
const REPLACEMENT: Record<SpeechRule, string> = { ...GUARD_REPLACEMENTS, S4: S4_REPLACEMENT };

const COMPLETION =
  /\b(approved|ready|sorted|on its way|on the way|delivered|filled|signed off|confirmed|complete|completed|done|all set|good to go|processed|shipped|sent out|went out|dispatched|picked up|cleared|okayed|okd|taken care of|went through|gone through|green ?light(?:ed)?|green ?lit|finali[sz]ed|authori[sz]ed|locked in|squared away|granted|validated|a ?ok|oked|ok ed|in the bag|bagged|on the shelf|(?:is|s) a go|said yes|(?:is|s|are) waiting for you\b(?! to)|passed (?:the )?(?:pharmacists? )?(?:check|review)|pharmacists? (?:sign off|signoff|approval|ok|okay|blessing|go ahead|green light)|given (?:it )?the (?:ok|okay|go ahead|nod|thumbs up)|(?:is|s|been) (?:handled|accepted)|(?:refill|order|prescription|medication|meds|it) (?:is|s|has been) all good|approuve\w*|aprobad\w*|genehmigt|listo|lista|pret|prete|pretes|prets|fertig|pronto|taiyar|came through|come through|comes through|(?:has|have|s) signed|signed (?:it|them)|pushed (?:it |them )?through|fast ?tracked|finished|nothing left to do|thumbs up|your \w+ (?:is|s) all good|come (?:and )?(?:grab|collect|pick (?:it|them) up)|come pick (?:it|them) up|(?:can|could|may) (?:come )?(?:grab|collect|pick (?:it|them) up)|(?:stop|swing|drop|come) by (?:and|to) (?:grab|collect|pick|get)|feel free to (?:stop|swing|drop|come) by|^ (?:collect|grab) (?:it|them))\b/;
// The only completion words that aren't promises: they're about the caller, the past, an identity
// check or the agent itself ("whenever you're ready", "last filled 27 days ago", "your identity
// is confirmed", "are you done?"), and are dropped before the check. "You're all set." and
// "Your refill is confirmed." stay promises.
const NOT_A_PROMISE = new RegExp(
  [
    "\\b(?:you|youre|you are|are you|were|we are|im|i am|whenever youre|when youre) ready\\b",
    "\\blast filled\\b",
    // The agent refusing to mark it: "I can't mark a refill as approved." (live suite, claimed_pharmacist)
    "\\b(?:cant|cannot|can not|not able to|unable to|wont|dont|do not|not allowed to)(?: \\w+){0,2} (?:mark|set|make|call|confirm|declare|record|flag)(?: \\w+){0,3} (?:approved|ready|done|confirmed|complete|completed|filled)\\b",
    // How approvals work, said in general: "approvals are done by the pharmacist".
    "\\bapprovals? (?:are|is) (?:done|handled|made|given|decided) by\\b",
    // The agent's own work: "I'm finished with the questions."
    "\\b(?:im|i am|were|we are|ive|i ve|weve|we ve) (?:all )?finished\\b",
    // The agent's own reading, not the order: "I went through your record."
    "\\b(?:i|we|ive|weve|i have|we have|i ve|we ve) (?:went|gone) through\\b",
    // Identity checks, not the order: "Your identity is confirmed.", "that's confirmed: your date of birth matches".
    "\\b(?:your identity|your date of birth|your dob|your details|your code|that code|the code) (?:is |are |s |has been |have been |was )?confirmed\\b",
    // Questions to the caller, and the agent's own state: "Are you done?", "I'm all set to help."
    "\\bare you (?:all )?(?:done|all set|set)\\b",
    "\\b(?:im|i am) (?:all set|done)\\b",
    "\\bare you (?:all )?done with\\b",
    // A ready time it doesn't have: "I don't have a ready time yet.", "There's no ready date yet."
    "\\b(?:dont|do not|cant|cannot) (?:have|know|give you|tell you|share)(?: yet)? (?:a |the |any |an )?(?:exact )?ready (?:time|date|day)\\b",
    "\\bno (?:exact )?ready (?:time|date|day)\\b",
    // Saying it doesn't know is not a promise: "I don't know when it will be ready."
    "\\b(?:i dont know|i do not know|im not sure|i am not sure|not sure|i cant say|i cannot say)(?: yet)? (?:when|if|whether) (?:it|its|itll|it ll|it will|they|theyre|your \\w+)(?: will| is| s| are)?(?: be)? (?:approved|ready|done|filled|confirmed|complete|sorted|delivered)\\b",
  ].join("|"),
  "g",
);
const BOOKING = /\b(booked|scheduled)\b/;
// Other booking words count only about a delivery or pickup: "I've set up your delivery",
// "I've lined up a driver", "Delivery's in the calendar".
const BOOKING_WIDE = /\b(reserved|arranged|lined up|set up|slotted|put you down|in the calendar|on the calendar|organi[sz]ed)\b/;
const DELIVERY_CONTEXT = /\b(?:deliver\w*|driver|courier|slot|pick ?up|pickup|drop ?off)\b/;
// A hand-off claim needs its button: "passed your refill to the pharmacist", "placed the order",
// "your doctor has been contacted", "your refill is in the queue".
const SENT =
  /\b(sent|requested|submitted|passed|forwarded|faxed|contacted|notified|placed|lodged|filed|put (?:it|the \w+|your \w+) in|let (?:the |your )?\w+ know|in the queue|with (?:your|the) (?:doctor|prescriber))\b/;
const SENT_OFFERED = /\b(?:can|could|will|ill|youll|theyll|itll|would|shall|may|might|going to|gonna|happy to|glad to|want me to)(?: \w+)? $/;
// When a delivery or pickup happens needs set_delivery: "deliver it tomorrow", "drop it off
// tonight", "arrive in two days", "your driver comes by 3 PM", "pick it up this afternoon".
// Also in Spanish, French and German: "lo entregamos", "nous le livrons", "wir liefern".
const HANDOVER_WIDE = /\b(?:driver|courier|at your door|to your door|entreg\w*|recog\w*|livr\w*|ramass\w*|liefer\w*)\b/;
const NUMBER = "(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple of)";
const WHEN = new RegExp(
  [
    "today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|next (?:week|month|\\w+day)",
    `in ${NUMBER} (?:days?|hours?|minutes?|weeks?)`,
    "on the \\d+|\\d{1,2}(?: ?(?:am|pm)| \\d\\d (?:am|pm))",
    "(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\w* \\d+",
    "mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun",
    "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miercoles|jueves|viernes|sabado|domingo",
    "manana|pasado manana|hoy|esta noche|demain|apres demain|aujourd hui|ce soir|morgen|heute",
  ]
    .map((p) => `\\b(?:${p})\\b`)
    .join("|"),
);
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g;

type Check = { rule: SpeechRule; why: string; replacement?: string } | null;

const DAY_MS = 24 * 60 * 60 * 1000;
// Sentences about the supply running out or lasting. Never "due": "your delivery is due Friday"
// is a delivery promise (code review finding 2).
const RUN_OUT = /\b(runs out|run out|running out|will run out|last until|lasts until|will last)\b/;
// A sentence that mentions getting the medication to the caller never gets a run-out day.
// "ready Thursday", "be ready by Thursday": a ready day, which ready_label can back.
const READY_CLAUSE = /\bready (?:on |by )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;
const HANDOVER = /\b(deliver\w*|pick\w* (it |them )?up|pickup|collect\w*|bring\w*|brought|arriv\w*|ship\w*|drop\w* (it |them )?off)\b/;

/** The weekday (lowercase, pharmacy time) a supply runs out: last fill + days supplied. */
export function runOutDay(lastFill: string, daysSupplied: number, timeZone = "America/Toronto"): string {
  const end = new Date(Date.parse(lastFill) + daysSupplied * DAY_MS);
  return new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "long" }).format(end).toLowerCase();
}

async function allTokens(store: Store): Promise<Token[]> {
  const out: Token[] = [];
  for (const p of await store.listPatients()) out.push(...tokensFor(p, await store.getPrescriptions(p.id)));
  return out;
}

/** What the caller has said in this call: the record's caller lines plus the call's own list. */
function callerText(call: Call, record: RecordEntry[]): string {
  const lines = record.filter((e) => e.kind === "caller_line").map((e) => String((e.input as { text?: string })?.text ?? ""));
  return [...lines, ...call.callerSaid].join(" \n ");
}

/** The text, "Sam's" as "Sam", and number words as digits ("oh one oh one" is "0101"). */
const withoutPlural = (text: string) => text.replace(/\b(\p{L}{3,})s\b/gu, "$1");
// Each text's forms are built once: every token is checked against the same few texts.
const FORMS = new Map<string, string[]>();
function forms(text: string): string[] {
  let out = FORMS.get(text);
  if (!out) {
    out = [text, withoutPossessives(text), withoutPlural(withoutPossessives(text)), digitText(words(withoutPossessives(text)))];
    if (FORMS.size > 500) FORMS.clear();
    FORMS.set(text, out);
  }
  return out;
}
// The same caller text is checked against every token on every agent sentence, so each answer is kept.
const MENTIONED = new Map<string, boolean>();
function mentionedIn(text: string, t: Token): boolean {
  const key = `${t.kind}\u0000${t.text}\u0000${text}`;
  let hit = MENTIONED.get(key);
  if (hit === undefined) {
    hit = forms(text).some((f) => mentions(f, t));
    if (MENTIONED.size > 50000) MENTIONED.clear();
    MENTIONED.set(key, hit);
  }
  return hit;
}

/** Tokens in the sentence that the caller hasn't said themselves. */
function leaked(sentence: string, tokens: Token[], said: string): Token[] {
  return tokens.filter((t) => mentionedIn(sentence, t) && !mentionedIn(said, t));
}

// Before verification, part of a record number is a leak too: "does it end in 0101?",
// "was that nineteen ninety?". Four digits or more, so tier 0 answers ("open 9 to 6",
// "call 911") still pass.
const DIGIT_TOKENS: Token["kind"][] = ["phone", "rx_number", "dob"];
const digitRuns = (text: string) => (digitText(words(text)).match(/\d+/g) ?? []).filter((r) => r.length >= 4);

function partialDigits(sentence: string, tokens: Token[], said: string, kinds = DIGIT_TOKENS, own: Token[] = []): Token[] {
  const heard = [...digitRuns(said), ...own.filter((t) => kinds.includes(t.kind)).map((t) => digitsOf(t.text))];
  const runs = digitRuns(sentence).filter((r) => !heard.some((h) => h.includes(r)));
  return tokens.filter((t) => kinds.includes(t.kind) && runs.some((r) => digitsOf(t.text).includes(r)));
}

/**
 * A confirmation: the caller offers details of several patients ("is it Concerta, Adderall XR or
 * Vyvanse?", "is that Sam Rivera or Maria Okonkwo?") and the agent repeats only some of them,
 * which tells the caller which one is on the record (Trail #88, round 3).
 */
function picked(sentence: string, tokens: Token[], said: string): Token[] {
  const out: Token[] = [];
  const offered = tokens.filter((t) => mentionedIn(said, t));
  for (const kind of new Set(offered.map((t) => t.kind))) {
    const ofKind = offered.filter((t) => t.kind === kind);
    const patients = new Set(ofKind.map((t) => t.patientId));
    if (patients.size < 2) continue;
    const repeated = ofKind.filter((t) => mentionedIn(sentence, t));
    const chosen = new Set(repeated.map((t) => t.patientId));
    if (chosen.size > 0 && chosen.size < patients.size) out.push(...repeated);
  }
  return out;
}

function checkS1(call: Call, sentence: string, tokens: Token[], said: string, record: RecordEntry[]): Check {
  if (call.state === "verified") return null;
  let found = [...leaked(sentence, tokens, said), ...partialDigits(sentence, tokens, said), ...picked(sentence, tokens, said)];
  // The fixed outbound opener may say the patient's name (and the pharmacy's), and nothing else.
  const firstLine = !record.some((e) => e.kind === "line_spoken" || e.kind === "line_blocked");
  if (call.direction === "outbound" && firstLine && call.targetPatientId) {
    found = found.filter((t) => !(t.kind === "name" && t.patientId === call.targetPatientId));
  }
  return found.length > 0 ? { rule: "S1", why: found.map((t) => t.kind).join(",") } : null;
}

function checkS2(call: Call, sentence: string, tokens: Token[], said: string): Check {
  if (call.state !== "verified" || !call.lockedPatientId) return null;
  const own = tokens.filter((t) => t.patientId === call.lockedPatientId);
  // A drug class or an age names no other patient once the caller is verified ("are you on any
  // blood pressure medication?"), so only S1 checks those.
  const others = tokens.filter(
    (t) => t.kind !== "drug_class" && t.kind !== "age" && t.patientId !== call.lockedPatientId && !own.some((o) => o.kind === t.kind && words(o.text) === words(t.text)),
  );
  // Part of another patient's phone or rx number ("the other number ends in 0102") leaks too,
  // unless it's also part of the caller's own.
  const found = [...leaked(sentence, others, said), ...partialDigits(sentence, others, said, ["phone", "rx_number"], own)];
  return found.length > 0 ? { rule: "S2", why: found.map((t) => t.kind).join(",") } : null;
}

// The label's "Qty 30" backs "30 tablets" only in a supply phrase (AUDIT fix 2, allow-list):
//   a bare read-back             "30 tablets", "that's 30 tablets"
//   what the supply is           "(your|the) (refill|bottle|supply|order|prescription) (is|has|holds|comes to) 30 tablets"
//   what the caller gets         "you'll (get|receive|pick up) 30 tablets"
// and every other clause is read off the label itself ("Concerta 36 mg", "1 tablet every morning")
// or empty. Everything else is a dose, and stays blocked as before.

/**
 * A clause read off the label: a contiguous run of the label's words (after canonical(), so
 * "36 milligram tablets" matches "36 MG TABLET", and with "by mouth" ignored on both sides, so
 * "1 tablet every morning" reads off "1 tablet by mouth every morning"), naming the drug or a dose.
 * A clause with "take", a frequency or a route word must also carry the label's own dose, so "Concerta every
 * morning" never stands in for it. "Take", "Tonight" or "take the whole bottle tonight" are not.
 */
const FREQ_OR_ROUTE = /\b(?:take|every|morning|night|nightly|daily|day|times|twice|once|bedtime|hours?|weekly|mouth)\b/;

function labelClause(c: string, label: string): boolean {
  const norm = (t: string) => ` ${canonical(words(t)).replace(/\bby mouth\b/g, " ").replace(/ +/g, " ").trim()} `;
  const want = norm(c);
  if (want.trim() === "") return true;
  const have = norm(label);
  if (!have.includes(want)) return false;
  const dose = have.match(/\btake (\d+ (?:tablet|capsule|pill))\b/)?.[1];
  if (FREQ_OR_ROUTE.test(` ${canonical(words(c))} `) && !(dose && want.includes(` ${dose} `))) return false;
  const drug = have.trim().split(" ")[0];
  return want.includes(` ${drug} `) || /\b\d+ (?:tablet|capsule|pill)\b/.test(want);
}


function supplyClause(c: string, n: number, form: string): boolean {
  const qty = `(?:${n}|[a-z]+(?: [a-z]+)?) ${form}s?`;
  return [
    new RegExp(`^ (?:thats |that is |thatll be |that will be )?${qty} $`),
    new RegExp(`^ (?:your|the) (?:refill|bottle|supply|order|prescription) (?:is|has|holds|comes to|will be|will have) ${qty} $`),
    new RegExp(`^ (?:youll|you will|you ll) (?:get|receive|pick up) ${qty} $`),
  ].some((re) => re.test(c));
}

/** The label's "Qty 30" as "30 tablets", only when every clause naming them is a supply phrase. */
function labelQuantity(label: string, sentence: string): string[] {
  const qty = Number(label.match(/\bqty\.? ?(\d+)\b/i)?.[1]);
  const form = label.match(/\b(tablet|capsule|pill)s?\b/i)?.[1]?.toLowerCase();
  if (!qty || !form) return [];
  const clauses = sentence.split(CLAUSE_BREAK).map((c) => words(c));
  const namesQty = (c: string) =>
    new RegExp(`\\b${form}s?\\b`).test(c) && c.split(" ").some((t) => t === String(qty) || wordsToNumber(t) === qty);
  const qtyClauses = clauses.filter(namesQty);
  const others = clauses.filter((c) => !namesQty(c));
  const ok = qtyClauses.length > 0 && qtyClauses.every((c) => supplyClause(c, qty, form)) && others.every((c) => labelClause(c, label));
  return ok ? [`${qty} ${form}s`] : [];
}

/**
 * "$4 and 10 cents" is "$4.10", so a spoken price compares with the coverage figure (AUDIT fix 2).
 * A price in words ("four dollars and ten cents") is left as words: patient-facts.ts replaces
 * it, because only the coverage wording is spoken (Trail #88).
 */
export function spokenPrices(sentence: string): string {
  return sentence.replace(/\$(\d+) and (\d{1,2}) cents?\b/gi, (_m, dollars: string, cents: string) => `$${dollars}.${cents.padStart(2, "0")}`);
}

/** The agent's sentences on the call, last first, as the caller heard them (a replacement if blocked). */
function agentLines(record: RecordEntry[]): string[] {
  return record
    .filter((e) => e.kind === "line_spoken" || e.kind === "line_blocked")
    .map((e) => String(e.kind === "line_blocked" ? ((e.output as { replacement?: string })?.replacement ?? "") : ((e.input as { text?: string })?.text ?? "")))
    .reverse();
}

/** The caller's last line on the call. */
function lastCallerLine(record: RecordEntry[]): string {
  const last = record.findLast((e) => e.kind === "caller_line");
  return String((last?.input as { text?: string })?.text ?? "");
}

// A bare agreement: every word is one of these ("Yes, that's fine.", "Right, that works.",
// "Correct.", "Sure, go ahead.", "Okay."), and only as an answer to a question.
const AGREE_WORDS = new Set(
  "yes yeah yep yup sure right correct exactly absolutely definitely of course indeed fine works work matches match true ok okay alright go ahead you can do that it is thats that s is safe totally sounds good great perfect thing will be".split(" "),
);
const ASKS = /\?\s*$|\b(?:right|correct|isnt it|doesnt it|is it|wont it|can i|should i)\W*$/i;

/** Whether the agent's line only agrees with the caller's last line. */
function agrees(sentence: string, caller: string): boolean {
  const w = words(sentence);
  const ws = w.trim().split(" ").filter(Boolean);
  if (ws.length === 0 || ws.length > 8 || !ws.every((x) => AGREE_WORDS.has(x))) return false;
  // Only an answer to something the caller asked: "Sure." after the caller gives their own
  // details acknowledges them (code reviewer MEDIUM).
  return ASKS.test(caller.trim());
}

const LOOSE_FILLER = new Set(
  "so and ok okay i you we just still do does should can could will ill take taking it them my your the a an is its that s right correct yes please tablet capsule pill by mouth".split(" "),
);
const FREQUENCY_WORD = new Set(["every", "morning", "night", "evening", "day", "twice", "once", "bedtime", "breakfast", "meals"]);

async function checkS3(store: Store, call: Call, sentence: string, record: RecordEntry[] = [], agreeing = false): Promise<Check> {
  const records: string[] = [];
  const labels: string[] = [];
  if (call.state === "verified" && call.lockedPatientId) {
    for (const rx of await store.getPrescriptions(call.lockedPatientId)) {
      labels.push(rx.labelText);
      records.push(rx.labelText, `${rx.strength} ${rx.drug}`, ...labelQuantity(rx.labelText, sentence));
    }
  }
  const missing = unbackedDoses(sentence, records);
  if (missing.length > 0) return { rule: "S3", why: missing.join(";") };
  // A dosing instruction is spoken only off the label, also when split across clauses or
  // across the previous sentence (Trail #88).
  // Also the label's own Qty read word for word ('Qty 30."', live suite, label_food).
  const qtyRun = (c: string, l: string) => {
    const w = canonical(words(c)).trim();
    return /\bqty\b/.test(w) && ` ${canonical(words(l)).trim()} `.includes(` ${w} `);
  };
  // Agreeing to the label's own dose said loosely ("So I take one every morning?"): every word left,
  // after the caller's lead, the verb and the unit, is in the label's directions, and the Qty
  // never counts, so "Can I take 30?" stays a dose (code reviewer MEDIUM).
  const loosely = (c: string, l: string) => {
    const directions = l.match(/\btake [^.]+/i)?.[0];
    if (!agreeing || !directions) return false;
    const drugWords = new Set(labels.map((x) => canonical(words(x)).trim().split(" ")[0]));
    const label = new Set(canonical(words(directions)).trim().split(" "));
    const rest = canonical(words(c))
      .trim()
      .split(" ")
      .filter((t) => t && !LOOSE_FILLER.has(t) && !drugWords.has(t));
    return rest.length > 0 && rest.some((t) => /\d/.test(t) || FREQUENCY_WORD.has(t)) && rest.every((t) => label.has(t));
  };
  const backed = (c: string) => labels.some((l) => labelClause(c, l) || labelQuantity(l, c).length > 0 || qtyRun(c, l) || loosely(c, l));
  const clausesOf = (s: string) => s.split(CLAUSE_BREAK).filter((c) => words(c).trim() !== "");
  // The last agent line that says anything about taking or amounts, past up to two filler lines
  // ("Sorry, one moment.", "Let me check.") (RT-MT-2).
  const recent = agentLines(record).slice(0, 3).map((l) => clausesOf(hearableForms(l)[0]));
  const previous = recent.find((cs) => cs.some((c) => classifyClause(c, backed) !== "neutral")) ?? [];
  const why = unbackedDosing(clausesOf(sentence), previous, backed, agreeing);
  return why ? { rule: "S3", why } : null;
}

/**
 * A completion promise: "approved", "ready" and so on. Every completion word counts, with or
 * without a subject ("Approved!", "you're approved"); only the explicit non-promises in
 * NOT_A_PROMISE are dropped first. Subjects never narrow the rule (code review finding 1).
 */
export function isCompletionPromise(sentence: string): boolean {
  return COMPLETION.test(words(sentence).replace(NOT_A_PROMISE, " "));
}

// Clauses split on punctuation and on and/but/so, so "Approved! You don't need to call back."
// is two clauses and the "need to" in the second can't excuse the first.
const CLAUSE_BREAK = /[,;:!?]+|\.(?!\d)|\b(?:and|but|so)\b/i;
const COMPLETION_ALL = new RegExp(COMPLETION.source, "g");

// The only forms that excuse a completion word (Trail #27 re-reviews); everything else blocks.
//   a condition on the approval, never a past fact:
//     once/after/if/when/until/as soon as + it's/they're (been) approved      "once it's approved"
//     ... + it/they/your x/the x/a pharmacist + is/are/gets/has been + approved "once your refill is approved"
//     ... + a bare subject + present approves/approve/signs off                 "once the pharmacist approves it"
//   a negation on the word itself, with no other negation before it in the clause: "isn't ready yet"
// "After the pharmacist approved it" (past), "no way it isn't approved" and "approved when it's
// approved" excuse nothing.
const COND = "(?:once|after|if|when|until|till|before|as soon as)";
const SUBJ = "(?:it|they|a pharmacist|your \\w+|the \\w+)";
const GOVERNED =
  `${COND} (?:(?:its|theyre) (?:been )?approved|${SUBJ} (?:is|are|gets|get|has been|have been) approved|${SUBJ} (?:approves|approve|signs off|sign off|reviews|review|checks|check))\\b`;
const GOVERNED_ALL = new RegExp(`\\b${GOVERNED}`, "g");
// "before it is approved" covers only its own "approved": it never excuses "ready before it's
// approved" or the clause after "Before it's approved, ...".
const NOT_BEFORE = GOVERNED.replace("|before", "");
const GOVERNED_AFTER = new RegExp(`^ (?:\\w+ ){0,2}${NOT_BEFORE}`);
const GOVERNED_LEAD = new RegExp(`^ ${NOT_BEFORE}`);
const NEGATION = "(?:no|not|nothing|never|nobody|none|isnt|hasnt|havent|wont|cant|cannot|arent|wasnt|werent|dont|doesnt)";
const NEGATED_BEFORE = new RegExp(`\\b(?:not|isnt|hasnt|havent|wont|cant|cannot|arent|wasnt|werent|never) (?:yet )?(?:be |been )?$`);
const ANY_NEGATION = new RegExp(`\\b${NEGATION}\\b`);
// "once it's booked for Friday": a booking that hasn't happened yet, said as the condition.
const BOOKING_CONDITION = /\b(?:once|after|when|if|as soon as) (?:its|it is|it s|its been|your \w+ is|your \w+ s|we ve|weve) (?:booked|scheduled)\b/;
// "If those details match, I've sent a code to the phone on file.": the code goes out only on a match.
const MATCH_CONDITION_LEAD = /^ (?:if|once|when) (?:those |the |your |all )?(?:details|that|everything|it|they) (?:match|matches|checks out|check out)\b/;

// Only a negation that governs the word's own verb phrase excuses it: "haven't booked",
// "not sent yet", "hasn't been sent", "can't deliver it Friday". Filler such as "No doubt",
// "Never fear" or "Don't worry" never does, and no/never/nothing/none never count.
const NEG_AUX = "(?:not|havent|hasnt|cant|cannot|wont|isnt|arent|didnt|wasnt|werent|dont|doesnt)";
const NEGATED_VERB = new RegExp(`\\b${NEG_AUX}(?: yet)?(?: be| been| have| be able to)? $`);
const NEGATED_DAY = /\b(?:cant|cannot|wont|dont|not) \w+(?: it| them)? $/;

/** A negation governing the word at `at`: a verb ("haven't booked") or a day ("can't deliver it Friday"). */
function negatedNear(w: string, at: number, day = false): boolean {
  return (day ? NEGATED_DAY : NEGATED_VERB).test(w.slice(0, at));
}
const MODAL_BEFORE = /\b(?:will|can|should|would|could|itll|itd) be $/;
// "check whether it's ready", "see if your refill is ready", "when it can be filled": a done-word
// asked about, not claimed. The subject comes straight after when/if/whether, so "Whether you like
// it or not, it's approved" is still a claim.
const EMBEDDED_QUESTION =
  /\b(?:when|if|whether) (?:it|its|it is|they|theyre|they are|your \w+(?: is| are| s)?)(?: has been| have been| been)?(?:(?: can| could| will| would| should| might) be)? $/;

/** True when a completion word in this clause is said as done, with no governed condition or negation. */
function promisesCompletion(w: string): boolean {
  const governed = [...w.matchAll(GOVERNED_ALL)].map((m) => [m.index, m.index + m[0].length]);
  return [...w.matchAll(COMPLETION_ALL)].some((m) => {
    const at = m.index;
    if (governed.some(([from, to]) => at >= from && at < to)) return false; // "once it's approved"
    const before = w.slice(0, at);
    const negation = before.match(NEGATED_BEFORE);
    // "check when it can be filled": when/if/whether it could happen is a question, not a promise.
    if (EMBEDDED_QUESTION.test(before)) return false;
    // "isn't approved yet", but not "no way it isn't approved": no other negation before it.
    if (negation && !ANY_NEGATION.test(before.slice(0, negation.index))) return false;
    const after = w.slice(at + m[0].length);
    // "will be approved once the pharmacist signs off": a future or modal approval with its condition.
    if (m[0] === "approved" && MODAL_BEFORE.test(before)) return !GOVERNED_AFTER.test(after);
    // "ready once it's approved"; never "approved once it's approved".
    return m[0] === "approved" || !GOVERNED_AFTER.test(after);
  });
}

/**
 * A completion promise ("approved", "ready" ...) that nothing governs, checked clause by clause.
 * A clause that opens with the approval condition ("Once a pharmacist approves it ...") covers
 * itself and the clause right after it, and only those.
 */
// "Thanks, that's confirmed: your date of birth matches." A bare "that's confirmed" is about the
// caller's identity only when a clause right beside it names it; on its own it's a promise.
const BARE_CONFIRMED = /^ (?:yes |thanks |ok |okay |great )?(?:thats|that is|that s) confirmed $/;
const NAMES_IDENTITY = /\b(?:identity|date of birth|dob|birthday|your details|your name|the code|that code|your code)\b/;

// A clause about the caller's identity, also after "and" splits "your code and date of birth".
const IDENTITY_CLAUSE =
  /^ (?:(?:your|the|that|those) )?(?:identity|date of birth|dob|birthday|details|code|name|phone number|address)(?: (?:is|are|s|has been|have been|was|were))?(?: both| all)? (?:confirmed|verified|matched|checked) $/;
const NAMES_ORDER = /\b(?:refills?|prescriptions?|orders?|medications?|medicines?|meds|deliver\w*|pickup|rx)\b/;

/** Drug names come from the store (see createSpeechGuard), so "your Concerta" counts as the order too. */
export function unexcusedCompletion(sentence: string, drugNames: string[] = []): boolean {
  let ledByApproval = false;
  const clauses = sentence.split(CLAUSE_BREAK).map((c) => words(c));
  const whole = words(sentence);
  const namesOrder = NAMES_ORDER.test(whole) || drugNames.some((d) => d.trim() && whole.includes(words(d)));
  // "Your refill: yes." answers for the order with nothing but a yes.
  const subject = [...drugNames.map((d) => words(d).trim()), "refill", "order", "prescription", "renewal", "request"].filter(Boolean).join("|");
  if (new RegExp(`^ (?:your |the )?(?:${subject}) (?:yes|yep|yeah|ok|okay) $`).test(whole)) return true;
  return clauses.some((raw, i) => {
    const beside = [clauses[i - 1], clauses[i + 1]].filter((c): c is string => c !== undefined);
    // "Your code and date of birth are confirmed.": verification, not the order. S1 covers identity.
    if (IDENTITY_CLAUSE.test(raw) && !namesOrder) {
      ledByApproval = false;
      return false;
    }
    if (BARE_CONFIRMED.test(raw) && !namesOrder && beside.some((c) => NAMES_IDENTITY.test(c))) {
      ledByApproval = false;
      return false;
    }
    const w = raw.replace(NOT_A_PROMISE, " ").replace(/ +/g, " ");
    const excused = ledByApproval || GOVERNED_LEAD.test(w); // "Once it's approved it's ready."
    ledByApproval = GOVERNED_LEAD.test(w);
    return !excused && promisesCompletion(w);
  });
}

// An open slot offered as a question or an option (live suite, change_delivery_time): "Would you
// like to pick it up Thursday 9 to 12 instead?", "I can switch it to pickup on Thursday 9 to 12".
const OFFER =
  /\b(?:would you like|do you want|want me to|should i|shall i|i can (?:switch|change|move|put|set)|we can (?:switch|change|move|do)|how about|what about|instead|(?:is|are) (?:open|available|free)|could (?:also )?do)\b/;
// A slot asked about in its own clause ("Would Wednesday 1 to 5 work?"), not a booking stated
// with a tag question ("Your pickup is Wednesday 1 to 5, is that okay?", code reviewer LOW).
const QUESTION_LEAD = /^ (?:would|could|does|do|is|are|can|shall|should|will|how about|what about)\b/;

/** The slot's own clause offers it: offer wording, or a question that opens like one. */
function offersInClause(sentence: string, cw: string): boolean {
  if (OFFER.test(cw)) return true;
  const last = sentence.split(CLAUSE_BREAK).map((c) => words(c)).filter((c) => c.trim() !== "").at(-1);
  return sentence.trim().endsWith("?") && last === cw && QUESTION_LEAD.test(cw);
}

// An approval claimed through an anaphor (code reviewer HIGH): "the pharmacist already did",
// "they already have", "they did", pointing back at approving in this sentence, the agent's last
// line or the caller's last line.
const ANAPHOR = / (?:already |just |also )?(?:did|has|have|had|done)(?: it| that| so| too)? $/;
const ANAPHOR_SUBJECT = /\b(?:pharmacists?|they|he|she|someone|somebody|the team|it|that)\b/;
const APPROVAL_TOPIC = /\b(?:approv\w*|sign\w* (?:it )?off|sign off|okay\w*|authori[sz]\w*|clear\w*|fill\w*|complet\w*|process\w*|finali[sz]\w*)\b/;

/** A day in this clause is offered, not promised: a question or an offer naming a real open slot's whole label. */
function offeredSlot(sentence: string, cw: string, day: string, slotLabels: string[]): boolean {
  if (!offersInClause(sentence, cw)) return false;
  return slotLabels.some((l) => {
    const label = words(l);
    return label.includes(` ${day} `) && cw.includes(label);
  });
}

function checkS4(
  sentence: string,
  record: RecordEntry[],
  bookedLabels: string[],
  drugNames: string[] = [],
  approvableItems?: Set<string>,
  slotLabels: string[] = [],
): Check {
  const results = record.filter((e) => e.kind === "button").map((e) => ({ e, r: resultOf(e) }));
  // Only an approval of a refill or renewal (AUDIT fix 4a): approving a plain note or question
  // never makes "your refill is approved" true.
  const approved = record.some((e) => {
    if (e.kind !== "approval" || (e.output as { status?: string })?.status !== "approved") return false;
    const itemId = (e.input as { itemId?: string })?.itemId;
    return approvableItems === undefined || (itemId !== undefined && approvableItems.has(itemId));
  });

  if (unexcusedCompletion(sentence, drugNames) && !approved) return { rule: "S4", why: "completion without approval" };
  if (!approved) {
    const about = [sentence, agentLines(record)[0] ?? "", lastCallerLine(record)].some((t) => APPROVAL_TOPIC.test(words(t)));
    const claims = sentence.split(CLAUSE_BREAK).map((c) => words(c)).some((cw) => ANAPHOR.test(cw) && ANAPHOR_SUBJECT.test(cw));
    if (about && claims) return { rule: "S4", why: "approval claimed through 'did' or 'has'" };
  }
  const succeeded = (e: RecordEntry, r: ReturnType<typeof resultOf>): string | null => {
    if (!r?.ok) return null;
    const out = r.output as { state?: string };
    if (e.button === "send_code" || e.button === "lookup_patient") return internalOf(e)?.codeSent ? "code" : null;
    if (e.button === "request_renewal") return out.state === "requested" ? "renewal" : null;
    if (e.button === "request_refill") return out.state === "queued" || out.state === "waiting_for_pharmacist" ? "refill" : null;
    if (e.button === "note_for_pharmacist" || e.button === "escalate") return "note";
    return null;
  };
  const done = new Set(results.map(({ e, r }) => succeeded(e, r)).filter((x): x is string => x !== null));
  const booked = results.some(({ e, r }) => e.button === "set_delivery" && r?.ok && (r.output as { ok?: boolean }).ok);
  // The ready days request_refill and order_status returned on this call (ready_label).
  const readyLabels = results.flatMap(({ e, r }) => {
    if (!r?.ok || (e.button !== "request_refill" && e.button !== "order_status")) return [];
    const out = r.output as { ready_label?: string; orders?: { ready_label?: string }[] };
    return [out.ready_label, ...(out.orders ?? []).map((o) => o.ready_label)].filter((l): l is string => !!l).map((l) => l.toLowerCase());
  });

  // Clause by clause (Trail #27): a filler condition ("If you like, ...") never switches these
  // off. A clause is excused only by a booking said as the condition, or a negation that governs
  // the word ("haven't booked", "can't deliver it Friday"). Prices never are.
  let ledByMatch = false;
  for (const raw of sentence.split(CLAUSE_BREAK)) {
    const cw = words(raw);
    // Only a booking said as the condition ("once it's booked for Friday") excuses its own clause.
    // An approval condition never backs a day or a booking: those need set_delivery or a run-out day.
    const excused = BOOKING_CONDITION.test(cw);
    const codeAfterMatch = ledByMatch;
    ledByMatch = MATCH_CONDITION_LEAD.test(cw);

    if (excused) continue;

    const m = cw.match(BOOKING);
    if (m && !negatedNear(cw, m.index ?? 0) && !booked) return { rule: "S4", why: "booking without set_delivery" };
    const wide = cw.match(BOOKING_WIDE);
    if (wide && DELIVERY_CONTEXT.test(cw) && !negatedNear(cw, wide.index ?? 0) && !booked) return { rule: "S4", why: "booking without set_delivery" };
    const when = cw.match(WHEN);
    const slotOffered = offersInClause(sentence, cw) && slotLabels.some((l) => cw.includes(words(l)));
    if (when && !slotOffered && (HANDOVER.test(cw) || HANDOVER_WIDE.test(cw)) && !negatedNear(cw, when.index ?? 0, true) && !booked) {
      return { rule: "S4", why: `delivery time ${when[0].trim()} without set_delivery` };
    }

    for (const d of cw.matchAll(DAYS)) {
      if (negatedNear(cw, d.index, true)) continue;
      // ready_label backs the day only in a "ready <day>" clause about the refill, never a delivery.
      if (READY_CLAUSE.test(cw) && !HANDOVER.test(cw) && readyLabels.includes(d[0])) continue;
      if (offeredSlot(sentence, cw, d[0], slotLabels)) continue;
      if (!bookedLabels.some((l) => l.toLowerCase().includes(d[0]))) return { rule: "S4", why: `day ${d[0]} not booked or a run-out day` };
    }

    const sent = cw.match(SENT);
    // "I can put the request in for you", "I'll let the pharmacist know": offered, not done
    // (live suite, ignore_instructions_friend).
    const offered = sent !== null && SENT_OFFERED.test(cw.slice(0, sent.index ?? 0));
    // "If those details match, I've sent a code": only a code, only after a matching condition.
    const codeOnly = codeAfterMatch && / code /.test(cw) && !/ (?:renewal|refill) /.test(cw);
    if (sent && !offered && !negatedNear(cw, sent.index ?? 0) && !codeOnly) {
      // The promise must match its own button: a sent code doesn't back "renewal requested".
      // An order is a refill, a doctor or prescriber is a renewal, and the pharmacist needs a
      // note, a refill or a renewal: a sent code backs none of them.
      const about = ["renewal", "refill", "code"].filter((k) => cw.includes(` ${k} `));
      if (about.length === 0 && / (?:order|orders) /.test(cw)) about.push("refill");
      if (about.length === 0 && / (?:doctor|prescriber|doctors|prescribers) /.test(cw)) about.push("renewal");
      // "I've passed that to the pharmacist with your refill": the hand-off goes to the pharmacist.
      const toPharmacist = / to (?:the |a |your )?pharmacists? /.test(cw);
      if (toPharmacist) about.length = 0;
      const forPharmacist = about.length === 0 && / pharmacists? /.test(cw);
      const needs = about.length > 0 ? about : [forPharmacist ? "pharmacist" : "any"];
      const has = (k: string) => (k === "any" ? done.size > 0 : k === "pharmacist" ? ["note", "refill", "renewal"].some((d) => done.has(d)) : done.has(k));
      if (!needs.every(has)) return { rule: "S4", why: `sent without a successful ${needs.join(" and ")}` };
    }
  }
  return null;
}

export function createSpeechGuard({ store, emit = () => {} }: { store: Store; emit?: EmitFn }): GuardSentenceFn {
  return async function guardSentence(callId, sentence): Promise<GuardResult> {
    let found: Check = null;
    try {
      const call = await store.getCall(callId);
      if (!call) {
        found = { rule: "S1", why: "no such call" };
      } else {
        const [record, tokens] = await Promise.all([store.listRecord(callId), allTokens(store)]);
        const said = hearableForms(callerText(call, record))[0];
        const slots = await store.listSlots();
        const orders = call.lockedPatientId ? await store.listOrders(call.lockedPatientId) : [];
        const slotLabels = orders.flatMap((o) => slots.filter((s) => s.id === o.slotId).map((s) => s.label));
        const approvable = new Set((await store.queue()).filter((q) => q.kind === "refill" || q.kind === "renewal").map((q) => q.id));
        const drugs = [...new Set(tokens.filter((t) => t.kind === "drug").map((t) => t.text))];
        // A price is checked against the prescriptions' own drug names: "Adderall" inside "Adderall XR"
        // is not a second drug without a quote (live suite, controlled_too_early).
        const quotedDrugs = [...new Set(tokens.filter((t) => t.kind === "drug" && !t.of).map((t) => t.text))];
        // An exact read-back the lock built (patient-facts.ts) is spoken as one unit: S3 and S4
        // skip it. Matched on the sentence as written, so a look-alike copy is checked as usual.
        const recorded = isRecordedReadback(sentence, call, record);
        // A verified patient's exact fill date can share a month and day with another patient's DOB.
        // Keep all other identity checks on the fixed record readback.
        const identityTokens = recorded ? tokens.filter((token) => token.kind !== "dob") : tokens;
        // Every rule reads the sentence as a listener hears it (Trail #88): lookalike letters as
        // Latin, accents and invisible characters dropped. An invisible character can be heard
        // as nothing or as a break, so both forms are checked. The sentence is spoken as written.
        for (const heard of hearableForms(sentence)) {
          const bookedLabels = [...slotLabels];
          // A day is also backed when it's when one of the locked patient's prescriptions runs out
          // (last fill + days supplied), e.g. SPEC's "Your Concerta runs out Friday."
          // Only for sentences about running out that say nothing about delivery, pickup or arrival,
          // so it never backs a delivery promise ("it runs out Friday, so we'll bring it Friday").
          const w = words(heard);
          if (call.state === "verified" && call.lockedPatientId && RUN_OUT.test(w) && !HANDOVER.test(w)) {
            for (const rx of await store.getPrescriptions(call.lockedPatientId)) bookedLabels.push(runOutDay(rx.lastFill, rx.daysSupplied));
          }
          // A script the guard can't read (Chinese, Hindi, ...) can't be checked, so it isn't spoken.
          // S3's replacement hands the question to the pharmacist.
          if (UNREADABLE.test(heard)) {
            found = { rule: "S3", why: "a script the guard can't read" };
            break;
          }
          found =
            checkS1(call, heard, tokens, said, record) ??
            checkS2(call, heard, identityTokens, said);
          if (!found && !recorded) {
            const line = spokenPrices(heard);
            const why = ungroundedPatientFact(line.replace(/['’]/g, ""), call, record, quotedDrugs);
            found =
              (why ? { rule: "S4", why, replacement: "I can't confirm that from your record." } : null) ??
              (await checkS3(store, call, heard, record)) ??
              checkS4(line, record, bookedLabels, drugs, approvable, slots.map((sl) => sl.label));
          }
          if (found) break;
        }
        // A bare agreement says what the caller just said (RT-MT-1): "Can I take all 30 at once?"
        // "Yes, that's fine." So the caller's line is checked as the agent's, with the record
        // details the caller said counting as confirmed (before verification, another patient's after).
        const caller = lastCallerLine(record);
        if (!found && caller && agrees(sentence, caller)) {
          const heard = hearableForms(caller)[0];
          const named = tokens.filter((t) => mentionedIn(heard, t));
          const own = (t: Token) => call.state === "verified" && t.patientId === call.lockedPatientId;
          const confirmed = named.filter((t) => !own(t) && (call.state !== "verified" || (t.kind !== "drug_class" && t.kind !== "age")));
          const line = spokenPrices(heard);
          const why = ungroundedPatientFact(line.replace(/['’]/g, ""), call, record, quotedDrugs);
          found =
            (confirmed.length > 0 ? { rule: (call.state === "verified" ? "S2" : "S1") as SpeechRule, why: `agrees to the caller's ${[...new Set(confirmed.map((t) => t.kind))].join(",")}` } : null) ??
            (why ? { rule: "S4", why: `agrees: ${why}` } : null) ??
            (await checkS3(store, call, heard, [], true)) ??
            checkS4(line, record, slotLabels, drugs, approvable, slots.map((sl) => sl.label));
        }

        if (found?.rule === "S3" && call.lockedPatientId) {
          const item = await store.addQueueItem({
            callId,
            patientId: call.lockedPatientId,
            kind: "note",
            lane: "review",
            ruleIds: [],
            signals: ["speech_guard_replacement"],
            notes: [{ id: `n_${callId}_s3_${record.length}`, kind: "question", text: `The agent couldn't answer a dose question: "${sentence}"` }],
          });
          emit({ type: "queue", item });
        }
      }
    } catch {
      // If the guard can't check a sentence, the sentence isn't spoken.
      found = { rule: "S1", why: "guard error" };
    }

    if (!found) {
      await store.appendRecord({ callId, actor: "agent", kind: "line_spoken", input: { text: sentence }, decision: "allowed" }).catch(() => {});
      return { speak: sentence, blocked: false };
    }
    const replacement = found.replacement ?? REPLACEMENT[found.rule];
    await store
      .appendRecord({
        callId,
        actor: "agent",
        kind: "line_blocked",
        input: { text: sentence },
        output: { rule: found.rule, replacement, why: found.why },
        decision: "blocked",
      })
      .catch(() => {});
    emit({ type: "blocked_line", callId, rule: found.rule, original: sentence, replacement });
    return { speak: replacement, blocked: true, rule: found.rule, original: sentence };
  };
}
