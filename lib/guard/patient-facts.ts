// The typed records are the source for statements about prior dispensing,
// insurance shares, appointments and requested quantities. A sentence that
// repeats a complete preformatted readback can be spoken as one unit.
import type { ButtonOutputs, Call, RecordEntry } from "@/lib/contract";
import { internalOf, resultOf } from "@/lib/control/context";
import { canonical } from "./doses";
import { words } from "./tokens";

type Coverage = ButtonOutputs["check_coverage"];

function outputOf(entry: RecordEntry): Record<string, unknown> | undefined {
  const result = resultOf(entry);
  return result?.ok ? result.output as Record<string, unknown> : undefined;
}

function sameLine(a: string, b: unknown): boolean {
  return typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
}

function ownPresses(call: Call, record: RecordEntry[]) {
  return call.state === "verified" && call.lockedPatientId
    ? record.filter(e => e.kind === "button" && internalOf(e)?.patientId === call.lockedPatientId)
    : [];
}

/** A new check (including an unavailable smaller fill) supersedes a prescription's earlier quote. */
function latestQuotes(record: RecordEntry[]): Coverage[] {
  const quotes = new Map<string, Coverage>();
  for (const e of record) {
    const out = outputOf(e);
    if (e.button !== "check_coverage" || !out) continue;
    const rx = internalOf(e)?.rxId;
    if (rx) quotes.set(rx, out as Coverage);
  }
  return [...quotes.values()];
}

export function isRecordedReadback(sentence: string, call: Call, record: RecordEntry[]): boolean {
  const presses = ownPresses(call, record);
  if (latestQuotes(presses).some(q => sameLine(sentence, q.coverage_readback))) return true;
  for (const e of presses) {
    const out = outputOf(e);
    if (!out) continue;
    if (e.button === "check_prescription" && sameLine(sentence, out.history_readback)) return true;
    if (e.button === "request_refill" && sameLine(sentence, out.supply_text)) return true;
    if (e.button === "note_for_pharmacist" && sameLine(sentence, out.confirmation_text)) return true;
  }
  // The latest appointment inventory supersedes prior offers, particularly after a booking.
  const recent = presses.findLast(e => {
    const out = outputOf(e);
    return (e.button === "order_status" && Array.isArray(out?.appointment_slots))
      || (e.button === "note_for_pharmacist" && Boolean(out?.appointment_id));
  });
  if (recent?.button !== "order_status") return false;
  const status = outputOf(recent);
  return list(status?.appointment_slots).some(s => sameLine(sentence, s.availability_text))
    || list(status?.appointments).some(s => sameLine(sentence, s.confirmation_text));
}

const quantityOrDate = /\b(?:\d+|yesterday|today|last (?:week|month)|january|february|march|april|may|june|july|august|september|october|november|december|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const history = /\b(?:last (?:refill|fill|dispense|dispensed|filled)|previous (?:fill|supply)|(?:you|we) (?:got|received|dispensed|filled)|dispensed quantity|refills? (?:remaining|left))\b/i;
const appointment = /\b(?:appointment|consultation|meeting)\b/i;
const appointmentClaim = /\b(?:available|booked|scheduled|confirmed|reserved|set for|arranged|is (?:at|on|for)|you (?:have|have got))\b/i;

// Match complete numeric tokens. Never truncate $4.123 to $4.12 or $4,100 to $4.
const currency = /\$\s*(\d+(?:[,.]\d+)*)/g;
const validAmount = /^\d+(?:\.\d{1,2})?$/;
const nonDollarNotation = /\b(?:dollars?|bucks?|cents?|cad|usd|(?:is|its|it is|will be|completely|totally) free|free (?:of charge|on your plan)|fully covered|covered (?:in full|completely|entirely|100 percent)|no (?:copay|co-pay|charge|cost)|pay nothing)\b|[£€]/i;
const priceContext = /\b(?:co-?pay|(?:plan|insurance) (?:pays?|covers?)|(?:your|patient) (?:price|cost|share)|you(?:'ll| will)? (?:owe|pay))\b/i;
const planSubject = /\b(?:plan|insurance|insurer)\s+(?:would |will )?(?:pays?|covers?|contributes?)\b|\b(?:covered|paid) by (?:your |the )?(?:plan|insurance)\b/i;

const HISTORY_CLAUSE = /[,;!?]|\.(?!\d)|\b(?:and|but|so|because)\b/i;
const REFILL_COUNT = /\b(\d+) refills? (?:remaining|left)\b/;

/**
 * A fill-history claim the record doesn't back, clause by clause, so "one" in "I can't add one
 * myself" isn't a quantity beside "no refills left". A clause whose only number is a refill count
 * ("no refills left" is 0) is backed by refills_left from this call's check_prescription
 * (live suite, extra_refills, Trail #88). Any other quantity or date still needs the read-back.
 */
function unbackedHistory(sentence: string, call: Call, record: RecordEntry[]): boolean {
  const left = new Set(
    ownPresses(call, record).flatMap((e) => {
      const out = outputOf(e);
      return e.button === "check_prescription" && typeof out?.refills_left === "number" ? [out.refills_left] : [];
    }),
  );
  return sentence.split(HISTORY_CLAUSE).some((clause) => {
    if (!history.test(clause)) return false;
    const c = canonical(clause).replace(/\bno (?:more )?refills?\b/g, "0 refills");
    if (!quantityOrDate.test(c)) return false;
    const count = c.match(REFILL_COUNT);
    if (count && !quantityOrDate.test(c.replace(REFILL_COUNT, " "))) return !left.has(Number(count[1]));
    return true;
  });
}

/** Returns a reason for a factual assertion that cannot be tied to the current call. */
export function ungroundedPatientFact(sentence: string, call: Call, record: RecordEntry[], drugNames: string[]): string | null {
  const normalized = canonical(sentence);
  if (unbackedHistory(sentence, call, record)) return "fill history differs from the recorded readback";
  // Clause by clause: "what you're calling about today, like a refill, a price, or an appointment?"
  // names an appointment in one clause and a day in another (live suite, greeting_slang_recovery).
  if (sentence.split(HISTORY_CLAUSE).some((c) => appointment.test(c) && (appointmentClaim.test(c) || quantityOrDate.test(canonical(c))))) {
    return "appointment differs from the recorded offer or booking";
  }
  const supplyQuestion = /^would you like (?:me to request |to request )?(?:a |the )?\d+ day supply(?: of [a-z ]+)?$/i.test(normalized.trim().replace(/[.?]$/, ""));
  if (/\b\d+ day supply\b/.test(normalized) && !sentence.includes("$") && !supplyQuestion) {
    return "supply differs from the recorded readback";
  }

  // Spoken-dollar and free-text assertions need the exact, currency-formatted quote.
  if (nonDollarNotation.test(sentence) || priceContext.test(sentence) && /\d/.test(normalized) && !sentence.includes("$")) {
    return "amount differs from the recorded coverage wording";
  }
  if (!sentence.includes("$")) return null;

  const names = drugNames.filter(name => name && words(sentence).includes(words(name)));
  const requestedDays = normalized.match(/\b(\d+) day supply\b/)?.[1];
  const quotes = latestQuotes(ownPresses(call, record)).filter(q => !names.length || names.includes(q.drug));
  if (!quotes.length || names.some(name => !quotes.some(q => q.drug === name))) return "no insurance quote for this prescription";
  for (const clause of sentence.split(/[,;!?]|\.(?!\d)|\b(?:and|but)\b/i)) {
    const figures = [...clause.matchAll(currency)];
    if (!figures.length && clause.includes("$")) return "invalid price";
    const key = planSubject.test(clause) ? "plan_pays" : "patient_pays";
    for (const [, amount] of figures) {
      if (!validAmount.test(amount) || !quotes.every(q => q.available && q[key] !== null
        && (!requestedDays || q.days_supply === Number(requestedDays))
        && Number(q[key]?.slice(1)) === Number(amount))) return "price or payer differs from the recorded coverage";
    }
  }
  // A comma thousands separator or currency suffix could otherwise be split off in the clause walk.
  if ([...sentence.matchAll(currency)].some(([, amount]) => !validAmount.test(amount))) return "invalid price";
  return null;
}
