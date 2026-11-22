// The speech guard (SPEC Part 3, "Speech rules"). Every sentence the agent would say
// passes through guardSentence before speech. Pure code: it holds with the hijack on.
//   S1 before verification: nothing from the records the caller hasn't said
//   S2 after verification: nothing of another patient's the caller hasn't said
//   S3 every dose, frequency or quantity is on the locked patient's label or record
//   S4 every promise matches the record (approved, sent, booked, a price, a day)

import { GUARD_REPLACEMENTS, type Call, type EmitFn, type GuardResult, type GuardSentenceFn, type RecordEntry, type SpeechRule, type Store } from "@/lib/contract";
import { internalOf, resultOf } from "@/lib/control/context";
import { canonical, unbackedDoses, wordsToNumber } from "./doses";
import { mentions, tokensFor, words, type Token } from "./tokens";

export const S4_REPLACEMENT = "A pharmacist will check it first, and I'll confirm once it's approved.";
const REPLACEMENT: Record<SpeechRule, string> = { ...GUARD_REPLACEMENTS, S4: S4_REPLACEMENT };

const COMPLETION =
  /\b(approved|ready|sorted|on its way|on the way|delivered|filled|signed off|confirmed|complete|completed|done|all set|good to go|processed|shipped|sent out|went out|dispatched|picked up|cleared|okayed|okd)\b/;
// The only completion words that aren't promises: they're about the caller, the past, an identity
// check or the agent itself ("whenever you're ready", "last filled 27 days ago", "your identity
// is confirmed", "are you done?"), and are dropped before the check. "You're all set." and
// "Your refill is confirmed." stay promises.
const NOT_A_PROMISE = new RegExp(
  [
    "\\b(?:you|youre|you are|are you|were|we are|im|i am|whenever youre|when youre) ready\\b",
    "\\blast filled\\b",
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
const SENT = /\b(sent|requested|submitted)\b/;
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g;
const PRICE = /\$\s?\d+(?:\.\d{2})?/g;

type Check = { rule: SpeechRule; why: string } | null;

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

/** Tokens in the sentence that the caller hasn't said themselves. */
function leaked(sentence: string, tokens: Token[], said: string): Token[] {
  return tokens.filter((t) => mentions(sentence, t) && !mentions(said, t));
}

function checkS1(call: Call, sentence: string, tokens: Token[], said: string, record: RecordEntry[]): Check {
  if (call.state === "verified") return null;
  let found = leaked(sentence, tokens, said);
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
  const others = tokens.filter((t) => t.patientId !== call.lockedPatientId && !own.some((o) => o.kind === t.kind && words(o.text) === words(t.text)));
  const found = leaked(sentence, others, said);
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

/** "$4 and 10 cents" is "$4.10", so a spoken price compares with the coverage figure (AUDIT fix 2). */
export function spokenPrices(sentence: string): string {
  return sentence.replace(/\$(\d+) and (\d{1,2}) cents?\b/gi, (_m, dollars: string, cents: string) => `$${dollars}.${cents.padStart(2, "0")}`);
}

async function checkS3(store: Store, call: Call, sentence: string): Promise<Check> {
  const records: string[] = [];
  if (call.state === "verified" && call.lockedPatientId) {
    for (const rx of await store.getPrescriptions(call.lockedPatientId)) {
      records.push(rx.labelText, `${rx.strength} ${rx.drug}`, ...labelQuantity(rx.labelText, sentence));
    }
  }
  const missing = unbackedDoses(sentence, records);
  return missing.length > 0 ? { rule: "S3", why: missing.join(";") } : null;
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

function checkS4(sentence: string, record: RecordEntry[], bookedLabels: string[], drugNames: string[] = [], approvableItems?: Set<string>): Check {
  const results = record.filter((e) => e.kind === "button").map((e) => ({ e, r: resultOf(e) }));
  // Only an approval of a refill or renewal (AUDIT fix 4a): approving a plain note or question
  // never makes "your refill is approved" true.
  const approved = record.some((e) => {
    if (e.kind !== "approval" || (e.output as { status?: string })?.status !== "approved") return false;
    const itemId = (e.input as { itemId?: string })?.itemId;
    return approvableItems === undefined || (itemId !== undefined && approvableItems.has(itemId));
  });

  if (unexcusedCompletion(sentence, drugNames) && !approved) return { rule: "S4", why: "completion without approval" };
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
  const prices = results
    .filter(({ e, r }) => e.button === "check_coverage" && r?.ok)
    .flatMap(({ r }) => Object.values((r as { output: Record<string, string> }).output));
  const norm = (p: string) => Number(p.replace(/[^\d.]/g, "")).toFixed(2);
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

    for (const price of raw.match(PRICE) ?? []) {
      if (!prices.some((p) => norm(p) === norm(price))) return { rule: "S4", why: `price ${price} not from check_coverage` };
    }
    if (excused) continue;

    const m = cw.match(BOOKING);
    if (m && !negatedNear(cw, m.index ?? 0) && !booked) return { rule: "S4", why: "booking without set_delivery" };

    for (const d of cw.matchAll(DAYS)) {
      if (negatedNear(cw, d.index, true)) continue;
      // ready_label backs the day only in a "ready <day>" clause about the refill, never a delivery.
      if (READY_CLAUSE.test(cw) && !HANDOVER.test(cw) && readyLabels.includes(d[0])) continue;
      if (!bookedLabels.some((l) => l.toLowerCase().includes(d[0]))) return { rule: "S4", why: `day ${d[0]} not booked or a run-out day` };
    }

    const sent = cw.match(SENT);
    // "If those details match, I've sent a code": only a code, only after a matching condition.
    const codeOnly = codeAfterMatch && / code /.test(cw) && !/ (?:renewal|refill) /.test(cw);
    if (sent && !negatedNear(cw, sent.index ?? 0) && !codeOnly) {
      // The promise must match its own button: a sent code doesn't back "renewal requested".
      const about = ["renewal", "refill", "code"].filter((k) => cw.includes(` ${k} `));
      const needs = about.length > 0 ? about : ["any"];
      if (!needs.every((k) => (k === "any" ? done.size > 0 : done.has(k)))) return { rule: "S4", why: `sent without a successful ${needs.join(" and ")}` };
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
        const said = callerText(call, record);
        const slots = await store.listSlots();
        const orders = call.lockedPatientId ? await store.listOrders(call.lockedPatientId) : [];
        const bookedLabels = orders.flatMap((o) => slots.filter((s) => s.id === o.slotId).map((s) => s.label));
        // A day is also backed when it's when one of the locked patient's prescriptions runs out
        // (last fill + days supplied), e.g. SPEC's "Your Concerta runs out Friday."
        // Only for sentences about running out that say nothing about delivery, pickup or arrival,
        // so it never backs a delivery promise ("it runs out Friday, so we'll bring it Friday").
        const w = words(sentence);
        if (call.state === "verified" && call.lockedPatientId && RUN_OUT.test(w) && !HANDOVER.test(w)) {
          for (const rx of await store.getPrescriptions(call.lockedPatientId)) bookedLabels.push(runOutDay(rx.lastFill, rx.daysSupplied));
        }
        found =
          checkS1(call, sentence, tokens, said, record) ??
          checkS2(call, sentence, tokens, said) ??
          (await checkS3(store, call, sentence)) ??
          checkS4(
            spokenPrices(sentence),
            record,
            bookedLabels,
            tokens.filter((t) => t.kind === "drug").map((t) => t.text),
            new Set((await store.queue()).filter((q) => q.kind === "refill" || q.kind === "renewal").map((q) => q.id)),
          );

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
    const replacement = REPLACEMENT[found.rule];
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
