// The speech guard (SPEC Part 3, "Speech rules"). Every sentence the agent would say
// passes through guardSentence before speech. Pure code: it holds with the hijack on.
//   S1 before verification: nothing from the records the caller hasn't said
//   S2 after verification: nothing of another patient's the caller hasn't said
//   S3 every dose, frequency or quantity is on the locked patient's label or record
//   S4 every promise matches the record (approved, sent, booked, a price, a day)

import { GUARD_REPLACEMENTS, type Call, type EmitFn, type GuardResult, type GuardSentenceFn, type RecordEntry, type SpeechRule, type Store } from "@/lib/contract";
import { internalOf, resultOf } from "@/lib/control/context";
import { unbackedDoses } from "./doses";
import { mentions, tokensFor, words, type Token } from "./tokens";

export const S4_REPLACEMENT = "A pharmacist will check it first, and I'll confirm once it's approved.";
const REPLACEMENT: Record<SpeechRule, string> = { ...GUARD_REPLACEMENTS, S4: S4_REPLACEMENT };

const CONDITIONAL = /\b(once|after|if|when|until|as soon as|pending|waiting|needs to|need to|will need|pharmacist will|not|isnt|hasnt|havent|wont|cant|cannot)\b/;
const COMPLETION = /\b(approved|ready|sorted|on its way|on the way|delivered|filled)\b/;
// The only completion words that aren't promises: they're about the caller or the past
// ("whenever you're ready", "last filled 27 days ago"), and are dropped before the check.
const NOT_A_PROMISE = /\b(you|youre|you are|are you|were|we are|im|i am|whenever youre|when youre) ready\b|\blast filled\b/g;
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

async function checkS3(store: Store, call: Call, sentence: string): Promise<Check> {
  const records: string[] = [];
  if (call.state === "verified" && call.lockedPatientId) {
    for (const rx of await store.getPrescriptions(call.lockedPatientId)) records.push(rx.labelText, `${rx.strength} ${rx.drug}`);
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
const CLAUSE_BREAK = /[,;:.!?]+|\b(?:and|but|so)\b/i;
const COMPLETION_ALL = new RegExp(COMPLETION.source, "g");
const LEADING_CONDITION = /^\s*(once|after|as soon as|when|if|until)\b/;
const ABOUT_APPROVAL = /\b(approv\w*|pharmacist|reviewed)\b/;

/**
 * A completion promise no conditional excuses. A conditional ("once", "not", "pending" ...)
 * excuses a completion word only in the same clause and when it comes before one
 * ("it'll be ready once it's approved"); a conditional after it ("ready when you are") doesn't.
 */
export function unexcusedCompletion(sentence: string): boolean {
  let ledByApproval = false;
  return sentence.split(CLAUSE_BREAK).some((clause) => {
    const w = words(clause).replace(NOT_A_PROMISE, " ");
    const excused = ledByApproval;
    // "Once a pharmacist approves it, it'll be ready.": a leading clause that sets the approval
    // as the condition also covers the clause right after it, and only that one.
    ledByApproval = LEADING_CONDITION.test(w) && ABOUT_APPROVAL.test(w);
    const completions = [...w.matchAll(COMPLETION_ALL)].map((m) => m.index);
    if (completions.length === 0 || excused) return false;
    const cond = w.search(CONDITIONAL);
    return cond < 0 || cond > Math.max(...completions);
  });
}

function checkS4(sentence: string, record: RecordEntry[], bookedLabels: string[]): Check {
  const w = words(sentence);
  const results = record.filter((e) => e.kind === "button").map((e) => ({ e, r: resultOf(e) }));
  const approved = record.some((e) => e.kind === "approval" && (e.output as { status?: string })?.status === "approved");

  // Before the conditional shortcut below, so a conditional elsewhere can't excuse a completion.
  if (unexcusedCompletion(sentence) && !approved) return { rule: "S4", why: "completion without approval" };
  if (CONDITIONAL.test(w)) return null;

  if (BOOKING.test(w)) {
    const booked = results.some(({ e, r }) => e.button === "set_delivery" && r?.ok && (r.output as { ok?: boolean }).ok);
    if (!booked) return { rule: "S4", why: "booking without set_delivery" };
  }

  for (const day of w.match(DAYS) ?? []) {
    if (!bookedLabels.some((l) => l.toLowerCase().includes(day))) return { rule: "S4", why: `day ${day} not booked or a run-out day` };
  }

  if (SENT.test(w)) {
    // The promise must match its own button: a sent code doesn't back "renewal requested".
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
    const about = ["renewal", "refill", "code"].filter((k) => w.includes(` ${k} `));
    const needs = about.length > 0 ? about : ["any"];
    const ok = needs.every((k) => (k === "any" ? done.size > 0 : done.has(k)));
    if (!ok) return { rule: "S4", why: `sent without a successful ${needs.join(" and ")}` };
  }

  const prices = results
    .filter(({ e, r }) => e.button === "check_coverage" && r?.ok)
    .flatMap(({ r }) => Object.values((r as { output: Record<string, string> }).output));
  const norm = (p: string) => Number(p.replace(/[^\d.]/g, "")).toFixed(2);
  for (const price of sentence.match(PRICE) ?? []) {
    if (!prices.some((p) => norm(p) === norm(price))) return { rule: "S4", why: `price ${price} not from check_coverage` };
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
          checkS4(sentence, record, bookedLabels);

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
