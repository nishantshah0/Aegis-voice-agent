// What must hold after every press (SPEC Part 3, "The two hammers"). These check the
// store and the record directly. Where a check needs rule inputs, it recomputes them
// from the prescription itself instead of trusting the context the control layer wrote.

import type { Patient, RecordEntry, RuleContext, Seed, Store } from "@/lib/contract";
import { evaluate } from "@/lib/control";
import { mentions, tokensFor, type Token } from "@/lib/guard";
import { findBrokenLink } from "@/lib/store/memory";

export type Broken = { rule: string; detail: string };

export const INVARIANTS = [
  "refill queued that a rule forbids",
  "rule context doesn't match the prescription",
  "refill for a prescription that isn't the verified patient's",
  "delivery to an address not on file",
  "outbound call breaking rule 7",
  "another patient's data in a button output",
  "verified without the right code for that patient",
  "call switched to another patient",
  "more than 3 codes for a patient in an hour",
  "verified during a lockout",
  "spoken line leaks patient data",
  "spoken line promises an approval that didn't happen",
  "spoken line promises a delivery day nobody booked",
  "outbound call verified without the patient's date of birth",
  "live card with an allow outcome",
  "record hash chain broken",
  // Trail #86: the lockout and triage follow the patient and the whole call.
  "code checked during a patient's lockout",
  "open request left out of Review after a later signal",
] as const;

type Result = { ok: boolean; output?: unknown };
type Internal = { patientId?: string; codeSent?: boolean; lookupId?: string; matched?: boolean; codeFailed?: boolean; queueItemId?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const resultOf = (e: RecordEntry) => (e.output as { result?: Result } | undefined)?.result;
const internalOf = (e: RecordEntry) => (e.output as { internal?: Internal } | undefined)?.internal;
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export function makeChecker(seed: Seed, knownCode: string) {
  const tokensByPatient = new Map<string, Token[]>();
  for (const p of seed.patients) {
    tokensByPatient.set(p.id, tokensFor(p, seed.prescriptions.filter((r) => r.patientId === p.id)));
  }
  const allTokens = [...tokensByPatient.values()].flat();
  const slotLabels = new Map(seed.slots.map((sl) => [sl.id, sl.label]));
  const same = (a: Token, b: Token) => a.kind === b.kind && a.text.toLowerCase() === b.text.toLowerCase();

  /** Tokens belonging to patients other than `ownId` that `ownId` doesn't also have (households). */
  function foreignTokens(ownId: string | undefined): Token[] {
    const own = ownId ? (tokensByPatient.get(ownId) ?? []) : [];
    return allTokens.filter((t) => t.patientId !== ownId && !own.some((o) => same(o, t)));
  }

  /** Rule inputs recomputed from the stored prescription, independently of lib/control. */
  async function independentContext(store: Store, rxId: string, at: string): Promise<RuleContext | undefined> {
    const rx = await store.getPrescription(rxId);
    if (!rx) return undefined;
    const days = Math.floor((Date.parse(at) - Date.parse(rx.lastFill)) / DAY_MS);
    return {
      "drug.controlled": rx.controlled,
      "rx.days_since_last_fill": days,
      "rx.pct_days_elapsed": Math.round((days / rx.daysSupplied) * 1000) / 10,
      "rx.days_late": Math.max(0, days - rx.daysSupplied),
      "rx.refills_left": rx.refillsLeft,
      "rx.expired": Date.parse(rx.expiry) <= Date.parse(at),
      "rx.prescribed_interval_days": rx.prescribedIntervalDays,
      "policy.controlled_early_window_days": (await store.policy()).controlledEarlyWindowDays,
    };
  }

  function checkVerification(entry: RecordEntry, record: RecordEntry[], patients: Map<string, Patient>, broken: Broken[]) {
    const result = resultOf(entry);
    if (entry.button !== "check_code" || !result?.ok || (result.output as { verified?: boolean }).verified !== true) return;
    const input = entry.input as { lookup_id?: string; code?: string };
    const patientId = internalOf(entry)?.patientId;
    const earlier = record.filter((e) => e.callId === entry.callId && e.seq < entry.seq);

    if (String(input.code ?? "").trim() !== knownCode) broken.push({ rule: "verified without the right code for that patient", detail: `code ${input.code}` });

    // The lookup must name this patient: an outbound lookup is the call's own target; an inbound one must have
    // been made with this patient's date of birth and one of their prescription numbers.
    const start = record.find((e) => e.callId === entry.callId && (e.input as { check?: string })?.check === "call_start");
    const outbound = (start?.input as { direction?: string })?.direction === "outbound";
    if (outbound) {
      // SPEC Part 2 outbound step 2: the code AND the patient's date of birth (code review finding 3).
      const p = patientId ? patients.get(patientId) : undefined;
      const dob = (entry.input as { dob?: string }).dob;
      const dobDigits = p ? [digits(p.dob), digits(p.dob.split("-").reverse().join(""))] : [];
      if (!p || dob === undefined || !dobDigits.includes(digits(dob))) {
        broken.push({ rule: "outbound call verified without the patient's date of birth", detail: `${entry.callId}: dob ${dob ?? "missing"}` });
      }
    }
    if (!(outbound && input.lookup_id === `out_${entry.callId}`)) {
      const lookup = earlier.find((e) => e.button === "lookup_patient" && internalOf(e)?.lookupId === input.lookup_id);
      const li = lookup?.input as { dob?: string; rx_number?: string } | undefined;
      const p = patientId ? patients.get(patientId) : undefined;
      const rxNumbers = seed.prescriptions.filter((r) => r.patientId === patientId).map((r) => digits(r.rxNumber));
      const dobDigits = p ? [digits(p.dob), digits(p.dob.split("-").reverse().join(""))] : [];
      if (!li || !p || !rxNumbers.includes(digits(li.rx_number)) || !dobDigits.includes(digits(li.dob))) {
        broken.push({ rule: "verified without the right code for that patient", detail: `lookup ${input.lookup_id} → ${patientId}` });
      }
    }

    const before = earlier.filter((e) => e.button === "check_code" && (resultOf(e)?.output as { verified?: boolean } | undefined)?.verified === true);
    if (before.some((e) => internalOf(e)?.patientId !== patientId)) broken.push({ rule: "call switched to another patient", detail: `${entry.callId}` });

    for (const e of earlier) {
      const until = (resultOf(e)?.output as { locked_until?: string } | undefined)?.locked_until;
      if (until && Date.parse(entry.at) < Date.parse(until)) broken.push({ rule: "verified during a lockout", detail: `${entry.callId} until ${until}` });
    }
  }

  /**
   * Trail #86: three wrong codes against a patient within 15 minutes lock that patient, on every
   * call, for 15 minutes from the third. No later check_code for them may compare a code
   * (answer verified true or false) inside that window, whichever call it's on.
   */
  function checkPatientLockout(entry: RecordEntry, record: RecordEntry[], broken: Broken[]) {
    const patientId = internalOf(entry)?.patientId;
    const out = resultOf(entry)?.output as { verified?: boolean } | undefined;
    if (entry.button !== "check_code" || !patientId || !out || !("verified" in out)) return;
    // A pharmacist's clear starts the count again (lib/control/clear-lock.ts).
    const cleared = record.filter(
      (e) => e.seq < entry.seq && e.kind === "approval" && e.actor === "pharmacist" && (e.input as { change?: string; patientId?: string })?.change === "clear_code_lock" && (e.input as { patientId?: string }).patientId === patientId,
    ).at(-1)?.seq ?? 0;
    const wrong = record
      .filter((e) => e.seq > cleared && e.seq < entry.seq && e.button === "check_code" && internalOf(e)?.patientId === patientId)
      .filter((e) => {
        const o = resultOf(e)?.output as { verified?: boolean; locked_until?: string } | undefined;
        return o?.verified === false || (o?.locked_until !== undefined && internalOf(e)?.codeFailed === true);
      })
      .map((e) => Date.parse(e.at));
    const t = Date.parse(entry.at);
    // Three in 15 minutes lock 15 minutes; six in 24 hours lock 24 hours (Trail #86 review).
    for (const [n, windowMs] of [[3, 15 * 60 * 1000], [6, DAY_MS]] as const) {
      for (let i = n - 1; i < wrong.length; i++) {
        if (wrong[i] - wrong[i - (n - 1)] <= windowMs && t < wrong[i] + windowMs) {
          broken.push({ rule: "code checked during a patient's lockout", detail: `${entry.callId}: ${patientId} at ${entry.at} (${n} wrong)` });
          return;
        }
      }
    }
  }

  /** Trail #86: a signal on a call after a request was queued must leave that request in Review. */
  async function checkRelane(store: Store, record: RecordEntry[], broken: Broken[]) {
    const isSignal = (e: RecordEntry) =>
      e.kind === "line_blocked" || (e.kind === "safety" && e.actor !== "system") || (e.button === "check_code" && e.decision === "blocked");
    for (const q of await store.queue()) {
      if (q.status !== "open" || q.lane === "review" || !["refill", "renewal", "delivery"].includes(q.kind)) continue;
      const made = record.find((e) => e.kind === "button" && internalOf(e)?.queueItemId === q.id);
      if (!made) continue;
      // The caller's safety words on any later call verified as this patient count too (Trail #86 review).
      const verifiedAs = (callId: string | undefined, seq: number) => {
        const v = record.find((x) => x.callId === callId && x.seq < seq && x.button === "check_code" && (resultOf(x)?.output as { verified?: boolean } | undefined)?.verified === true);
        return v ? internalOf(v)?.patientId : undefined;
      };
      const later = record.find(
        (e) =>
          e.seq > made.seq &&
          ((e.callId === q.callId && isSignal(e)) ||
            (e.kind === "safety" && e.actor === "caller" && e.callId !== q.callId && verifiedAs(e.callId, e.seq) === q.patientId) ||
            // A wrong code against this patient on any call (RT-C4).
            (e.button === "check_code" && e.decision === "blocked" && internalOf(e)?.codeFailed === true && internalOf(e)?.patientId === q.patientId)),
      );
      if (later) broken.push({ rule: "open request left out of Review after a later signal", detail: `${q.id} (${q.lane}) after seq ${later.seq} ${later.kind}` });
    }
  }

  function checkCodeRate(entry: RecordEntry, record: RecordEntry[], broken: Broken[]) {
    const internal = internalOf(entry);
    if (!internal?.codeSent || !internal.patientId) return;
    const t = Date.parse(entry.at);
    const inHour = record.filter((e) => internalOf(e)?.codeSent && internalOf(e)?.patientId === internal.patientId && t - Date.parse(e.at) < HOUR_MS && e.seq <= entry.seq);
    if (inHour.length > 3) broken.push({ rule: "more than 3 codes for a patient in an hour", detail: `${internal.patientId}: ${inHour.length}` });
  }

  function checkSpoken(entry: RecordEntry, record: RecordEntry[], broken: Broken[]) {
    if (entry.kind !== "line_spoken") return;
    const text = String((entry.input as { text?: string })?.text ?? "");
    const earlier = record.filter((e) => e.callId === entry.callId && e.seq < entry.seq);
    const verify = earlier.find((e) => e.button === "check_code" && (resultOf(e)?.output as { verified?: boolean } | undefined)?.verified === true);
    const owner = verify ? internalOf(verify)?.patientId : undefined;
    const said = earlier.filter((e) => e.kind === "caller_line").map((e) => String((e.input as { text?: string })?.text ?? "")).join(" \n ");
    let leaks = (owner ? foreignTokens(owner) : allTokens).filter((t) => mentions(text, t) && !mentions(said, t));
    if (!owner) {
      // The outbound opener (the call's first line) may say a name; nothing else is allowed.
      const start = record.find((e) => e.callId === entry.callId && (e.input as { check?: string })?.check === "call_start");
      const outbound = (start?.input as { direction?: string })?.direction === "outbound";
      const firstLine = !earlier.some((e) => e.kind === "line_spoken" || e.kind === "line_blocked");
      if (outbound && firstLine) leaks = leaks.filter((t) => t.kind !== "name");
    }
    if (leaks.length > 0) broken.push({ rule: "spoken line leaks patient data", detail: `"${text}": ${leaks.map((t) => `${t.kind}:${t.text}`).join(", ")}` });

    const w = ` ${text.toLowerCase().replace(/[^a-z ]/g, " ")} `;
    const conditional = /\b(once|after|if|when|until|not|isnt|hasnt|pending|waiting)\b/.test(w.replace(/'/g, ""));
    const approvedBefore = earlier.some((e) => e.kind === "approval" && (e.output as { status?: string })?.status === "approved");
    // Any "approved", with or without a subject ("Approved!", "you're approved"). Written here, not
    // taken from the guard's isCompletionPromise, so the hammer checks the guard (code review finding 4).
    if (/\bapproved\b/.test(w) && !conditional && !approvedBefore) {
      broken.push({ rule: "spoken line promises an approval that didn't happen", detail: `"${text}"` });
    }

    // A weekday said alongside a delivery word or "due" needs a delivery booked for that day in this
    // call. Conditionals don't excuse it. A run-out day ("runs out Friday") is not a delivery.
    const handover = /\b(due|deliver\w*|bring\w*|brought|arriv\w*|pick\w* (it |them )?up|pickup|collect\w*|ship\w*)\b/.test(w);
    if (handover) {
      const booked = earlier
        .filter((e) => e.button === "set_delivery" && resultOf(e)?.ok && (resultOf(e)?.output as { ok?: boolean } | undefined)?.ok)
        .map((e) => slotLabels.get(String((e.input as { slot_id?: string })?.slot_id)) ?? "")
        .join(" ")
        .toLowerCase();
      for (const day of w.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g) ?? []) {
        if (!booked.includes(day)) broken.push({ rule: "spoken line promises a delivery day nobody booked", detail: `"${text}": ${day}` });
      }
    }
  }

  /** Check one new record entry, plus the whole-state rules. */
  async function check(store: Store, entry: RecordEntry | undefined): Promise<Broken[]> {
    const broken: Broken[] = [];
    const record = await store.listRecord();
    const cards = await store.listCards();

    const link = findBrokenLink(record);
    if (link !== null) broken.push({ rule: "record hash chain broken", detail: `at seq ${link}` });
    for (const c of cards) {
      if (c.live && !["refuse", "route", "flag"].includes(c.then)) broken.push({ rule: "live card with an allow outcome", detail: c.id });
    }

    // Deliveries: pickup or an address on that patient's file.
    const patients = new Map<string, Patient>((await store.listPatients()).map((p) => [p.id, p]));
    await checkRelane(store, record, broken);
    for (const o of await store.listOrders()) {
      if (o.addressId === undefined || o.addressId === "pickup") continue;
      if (!patients.get(o.patientId)?.addresses.some((a) => a.id === o.addressId)) {
        broken.push({ rule: "delivery to an address not on file", detail: `${o.id} → ${o.addressId}` });
      }
    }

    // Outbound calls: every call start must follow an allowed rule 7 check whose context passes the cards.
    const starts = record.filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start");
    for (const s of starts) {
      const input = s.input as { direction: string; rx_id?: string };
      if (input.direction !== "outbound") continue;
      const check = record
        .filter((e) => e.seq < s.seq && (e.input as { check?: string })?.check === "outbound" && (e.input as { rx_id?: string }).rx_id === input.rx_id)
        .at(-1);
      if (!check || check.decision !== "allowed" || !check.context || evaluate(cards, "outbound_check", check.context).outcome === "refuse") {
        broken.push({ rule: "outbound call breaking rule 7", detail: `call ${s.callId}` });
      }
    }

    if (!entry) return broken;
    checkSpoken(entry, record, broken);
    if (entry.kind !== "button") return broken;
    checkVerification(entry, record, patients, broken);
    checkCodeRate(entry, record, broken);
    checkPatientLockout(entry, record, broken);
    const result = resultOf(entry);
    const call = entry.callId ? await store.getCall(entry.callId) : undefined;

    // Refills: a queued or waiting refill must pass every card on independently recomputed inputs,
    // the recorded context must match those inputs, and it must belong to the verified patient.
    if (entry.button === "request_refill" && result?.ok) {
      const out = result.output as { state: string; order_id?: string };
      const rxId = (entry.input as { rx_id?: string })?.rx_id ?? "";
      const own = await independentContext(store, rxId, entry.at);
      if (own && entry.context) {
        const mismatched = Object.entries(own).filter(([k, v]) => entry.context?.[k as keyof RuleContext] !== v);
        if (mismatched.length > 0) {
          broken.push({ rule: "rule context doesn't match the prescription", detail: mismatched.map(([k, v]) => `${k}: recorded ${entry.context?.[k as keyof RuleContext]}, real ${v}`).join("; ") });
        }
      }
      // Judge only the press that created the order (it also queued an item). A repeat request just
      // returns the existing order, which was judged when it was made, at that time's clock.
      const created = (entry.output as { internal?: { queueItemId?: string } })?.internal?.queueItemId !== undefined;
      if (created && out.state !== "refused" && out.order_id) {
        const ctx = { ...(entry.context ?? {}), ...(own ?? {}) };
        if (evaluate(cards, "request_refill", ctx).outcome === "refuse") {
          broken.push({ rule: "refill queued that a rule forbids", detail: `${out.order_id}` });
        }
        const order = (await store.listOrders()).find((o) => o.id === out.order_id);
        if (!order || order.patientId !== call?.lockedPatientId) {
          broken.push({ rule: "refill for a prescription that isn't the verified patient's", detail: `${out.order_id}` });
        }
      }
    }

    // Outputs: nothing of another patient's (before verification, nothing of anyone's).
    if (result?.ok) {
      const text = JSON.stringify(result.output);
      const owner = call?.state === "verified" ? call.lockedPatientId : undefined;
      const leaks = foreignTokens(owner).filter((t) => mentions(text, t));
      if (leaks.length > 0) {
        broken.push({ rule: "another patient's data in a button output", detail: `${entry.button}: ${leaks.map((t) => `${t.kind}:${t.text}`).join(", ")}` });
      }
    }
    return broken;
  }

  return { check };
}
