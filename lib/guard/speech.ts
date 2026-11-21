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
const BOOKING = /\b(booked|scheduled)\b/;
const SENT = /\b(sent|requested|submitted)\b/;
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g;
const PRICE = /\$\s?\d+(?:\.\d{2})?/g;

type Check = { rule: SpeechRule; why: string } | null;

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

function checkS4(sentence: string, record: RecordEntry[], bookedLabels: string[]): Check {
  const w = words(sentence);
  if (CONDITIONAL.test(w)) return null;
  const results = record.filter((e) => e.kind === "button").map((e) => ({ e, r: resultOf(e) }));
  const approved = record.some((e) => e.kind === "approval" && (e.output as { status?: string })?.status === "approved");

  if (COMPLETION.test(w) && !approved) return { rule: "S4", why: "completion without approval" };

  if (BOOKING.test(w)) {
    const booked = results.some(({ e, r }) => e.button === "set_delivery" && r?.ok && (r.output as { ok?: boolean }).ok);
    if (!booked) return { rule: "S4", why: "booking without set_delivery" };
  }

  for (const day of w.match(DAYS) ?? []) {
    if (!bookedLabels.some((l) => l.toLowerCase().includes(day))) return { rule: "S4", why: `day ${day} not booked` };
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
