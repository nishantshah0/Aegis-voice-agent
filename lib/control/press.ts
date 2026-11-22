// The control layer: the only way the AI acts (SPEC Part 3). Every press is checked,
// decided in code, written to the hash-chained record and emitted as a "press" event.
// press() never throws to the agent.

import { coverageFacts, lastFillFacts } from "@/lib/contract/patient-facts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomInt } from "node:crypto";
import {
  NEEDS_VERIFIED,
  type AppointmentSlot,
  type ButtonError,
  type ButtonInputs,
  type ButtonName,
  type ButtonResult,
  type Call,
  type CallId,
  type EmitFn,
  type StreamEvent,
  type Lane,
  type Patient,
  type PressDecision,
  type PressFn,
  type Prescription,
  type QueueItem,
  type RecordDecision,
  type RuleContext,
  type RuleId,
  type Signal,
  type StartCallOpts,
  type Store,
} from "@/lib/contract";
import { APPOINTMENT_CONFIRMATION_QUESTION, confirmsBooking } from "@/lib/contract/appointment-consent";
import { internalOf, loadContext, resultOf, type PressRecordOutput } from "./context";
import { evaluate, type Verdict } from "./engine";
import { chooseLane, signalsFromCards } from "./lanes";
import { addMs, fresh as isFresh, isBefore, MINUTE_MS, within } from "./time";
import { checkInput, normalise, normaliseDob, normaliseRxNumber } from "./validate";

export const MAX_CODE_TRIES = 3;
export const LOCKOUT_MS = 15 * MINUTE_MS;
export const CODE_VALID_MS = 10 * MINUTE_MS;
export const MAX_CODES_PER_HOUR = 3;
/** How long failed codes against a patient send that patient's requests to Review, on any call (Trail #86). */
export const FAILED_CODE_SIGNAL_MS = 60 * MINUTE_MS;

/** The lookup id an outbound call uses for send_code and check_code. */
export const outboundLookupId = (callId: CallId): string => `out_${callId}`;

export type ControlOptions = {
  store: Store;
  emit?: EmitFn;
  /** Makes the 6-digit code. Tests pass a fixed one; the default is random. */
  makeCode?: () => string;
  /**
   * Off by default (fails closed). When true, the code's digits go out on the shared event
   * stream, which anyone watching could read. Read the code with control.codeFor(callId).
   * Only a test that asks for the old text turns this on.
   */
  broadcastCodes?: boolean;
  /**
   * What each call id starts with; the number after it counts this store's calls. The live
   * pharmacy keeps "c_" (c_0001, c_0002…). A run on its own store (an attack card, a scenario)
   * passes its own, so its calls never share an id with a real one (AUDIT fix 14).
   */
  callIdPrefix?: string;
};

/** Refills that will be ready on a day: waiting for a pharmacist, queued or approved. */
const READY_STATES: ReadonlySet<string> = new Set(["waiting_for_pharmacist", "queued", "approved"]);
/** Days from the request until a refill is ready (pharmacist check plus fill). Sundays don't count. */
const READY_AFTER_DAYS = 2;

/**
 * The weekday a refill asked for at `at` is expected ready, in pharmacy time ("Thursday" for the
 * demo Tuesday). The record carries it as ready_label, so S4 can back "ready Thursday once it's
 * approved" (Role 1's 1.3 REQUEST).
 */
export function readyDay(at: string, timeZone = "America/Toronto"): string {
  const weekday = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "long" }).format(new Date(t));
  let t = Date.parse(at);
  for (let added = 0; added < READY_AFTER_DAYS; ) {
    t += 24 * 60 * 60 * 1000;
    if (weekday(t) !== "Sunday") added++;
  }
  return weekday(t);
}

export const CODE_SENT_TEXT = "A verification code was sent to your phone.";

type Handled = {
  result: ButtonResult;
  decision: RecordDecision;
  internal?: PressRecordOutput["internal"];
  context?: RuleContext;
};

const hashCode = (lookupId: string, code: string) => createHash("sha256").update(`${lookupId}:${code}`).digest("hex");

export function createControl({ store, emit = () => {}, makeCode, broadcastCodes = false, callIdPrefix = "c_" }: ControlOptions) {
  const newCode = makeCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  // Codes in plain text live only here, in memory, never in the record or on the stream.
  const sentCodes = new Map<CallId, { code: string; hash: string }>();

  const ok = <B extends ButtonName>(output: ButtonResult<B> extends infer R ? (R extends { ok: true; output: infer O } ? O : never) : never, ruleIds: RuleId[] = [], lane?: Lane) =>
    ({ ok: true, output, ruleIds, ...(lane ? { lane } : {}) }) as ButtonResult;
  const err = (error: ButtonError, ruleIds: RuleId[] = []): ButtonResult => ({ ok: false, error, ruleIds });
  const blocked = (error: ButtonError, ruleIds: RuleId[] = [], internal?: Handled["internal"]): Handled => ({
    result: err(error, ruleIds),
    decision: "blocked",
    internal,
  });

  async function addItem(item: Omit<QueueItem, "id" | "createdAt" | "status">): Promise<QueueItem> {
    const saved = await store.addQueueItem(item);
    send({ type: "queue", item: saved });
    return saved;
  }

  /** Signals from this call so far: failed codes, speech-guard replacements, safety words, side effects. */
  async function callSignals(call: Call): Promise<Signal[]> {
    const record = await store.listRecord(call.id);
    const signals = new Set<Signal>();
    if (call.failedCodeTries > 0 || record.some((e) => e.button === "check_code" && e.decision === "blocked")) signals.add("failed_code_attempts");
    // Failed codes against this patient on any call in the last hour: a redial doesn't clear them (Trail #86, RT-C2).
    if (call.lockedPatientId) {
      const now = await store.now();
      const failed = (await store.listRecord()).some(
        (e) => e.button === "check_code" && internalOf(e)?.codeFailed && internalOf(e)?.patientId === call.lockedPatientId && within(e.at, now, FAILED_CODE_SIGNAL_MS),
      );
      if (failed) signals.add("failed_code_attempts");
    }
    if (record.some((e) => e.kind === "line_blocked")) signals.add("speech_guard_replacement");
    if (record.some((e) => e.kind === "safety" && e.actor !== "system")) signals.add("safety_words");
    if (record.some((e) => e.button === "note_for_pharmacist" && (e.input as { kind?: string })?.kind === "side_effect")) signals.add("side_effect");
    return [...signals];
  }

  async function ownRx(call: Call, rxId: string | undefined): Promise<Prescription | undefined> {
    if (!rxId || !call.lockedPatientId) return undefined;
    const rx = await store.getPrescription(rxId);
    return rx && rx.patientId === call.lockedPatientId ? rx : undefined;
  }

  async function lockedPatient(call: Call): Promise<Patient | undefined> {
    return call.lockedPatientId ? store.getPatient(call.lockedPatientId) : undefined;
  }

  /** The patient a lookup id matched on this call, or null if it matched nobody. undefined if no such lookup. */
  async function findLookup(call: Call, lookupId: string): Promise<{ patientId: string | null } | undefined> {
    if (call.direction === "outbound" && lookupId === outboundLookupId(call.id)) {
      return { patientId: call.targetPatientId ?? null };
    }
    const entry = (await store.listRecord(call.id)).find((e) => e.button === "lookup_patient" && internalOf(e)?.lookupId === lookupId);
    if (!entry) return undefined;
    const internal = internalOf(entry);
    return { patientId: internal?.matched ? (internal.patientId ?? null) : null };
  }

  /** Send a code if this lookup matched and the patient hasn't had too many this hour. */
  async function maybeSendCode(call: Call, lookupId: string, patientId: string | null): Promise<Handled["internal"]> {
    if (!patientId) return { lookupId, matched: false };
    const now = await store.now();
    const sentThisHour = (await store.listRecord()).filter(
      (e) => internalOf(e)?.codeSent && internalOf(e)?.patientId === patientId && within(e.at, now, 60 * MINUTE_MS),
    ).length;
    if (sentThisHour >= MAX_CODES_PER_HOUR) return { lookupId, matched: true, patientId, codeSent: false };
    const code = newCode();
    const codeHash = hashCode(lookupId, code);
    afterRecord(() => sentCodes.set(call.id, { code, hash: codeHash }));
    const text = broadcastCodes ? `Your pharmacy verification code is ${code}.` : CODE_SENT_TEXT;
    send({ type: "phone", callId: call.id, kind: "code", text });
    return { lookupId, matched: true, patientId, codeSent: true, codeHash };
  }

  // ---------- The buttons ----------

  async function lookupPatient(call: Call, input: ButtonInputs["lookup_patient"]): Promise<Handled> {
    const lookupNumber = (await store.listRecord(call.id)).filter((e) => e.button === "lookup_patient").length + 1;
    const lookupId = `lk_${call.id}_${lookupNumber}`;
    const dob = normaliseDob(input.dob);
    const name = normalise(input.name);
    const rxNumber = normaliseRxNumber(input.rx_number);
    let match: string | null = null;
    for (const p of await store.listPatients()) {
      if (dob !== p.dob) continue;
      if (!name.includes(normalise(p.firstName)) || !name.includes(normalise(p.lastName))) continue;
      const rxs = await store.getPrescriptions(p.id);
      if (rxs.some((r) => normaliseRxNumber(r.rxNumber) === rxNumber)) match = p.id;
    }
    if (call.state === "greeting" || call.state === "collecting") await store.saveCall({ ...call, state: "code_sent" });
    const internal = await maybeSendCode(call, lookupId, match);
    return { result: ok<"lookup_patient">({ lookup_id: lookupId, message: "code sent if matched" }), decision: "allowed", internal };
  }

  async function sendCode(call: Call, input: ButtonInputs["send_code"]): Promise<Handled> {
    const lookup = await findLookup(call, input.lookup_id);
    if (!lookup) return blocked("not_found");
    const internal = await maybeSendCode(call, input.lookup_id, lookup.patientId);
    return { result: ok<"send_code">({ message: "code sent if matched" }), decision: "allowed", internal };
  }

  /** When each wrong code against this patient was entered, on any call, oldest first (Trail #86). */
  async function failedCodesFor(patientId: string): Promise<string[]> {
    return (await store.listRecord()).filter((e) => e.button === "check_code" && internalOf(e)?.codeFailed && internalOf(e)?.patientId === patientId).map((e) => e.at);
  }

  /**
   * The patient's lockout, worked out from the record so it holds across calls, redials and
   * servers (Trail #86, RT-C1): any three wrong codes within 15 minutes lock that patient for 15
   * minutes from the third. A clock moved back never ends it early.
   */
  function patientLockedUntil(failures: string[], now: string): string | undefined {
    let until: number | undefined;
    for (let i = MAX_CODE_TRIES - 1; i < failures.length; i++) {
      if (Date.parse(failures[i]) - Date.parse(failures[i - (MAX_CODE_TRIES - 1)]) <= LOCKOUT_MS) {
        until = Math.max(until ?? 0, Date.parse(failures[i]) + LOCKOUT_MS);
      }
    }
    return until !== undefined && until > Date.parse(now) ? new Date(until).toISOString() : undefined;
  }

  async function checkCode(call: Call, input: ButtonInputs["check_code"]): Promise<Handled> {
    const now = await store.now();
    let current = call;
    if (current.lockedUntil) {
      if (isBefore(now, current.lockedUntil)) {
        return { result: ok<"check_code">({ locked_until: current.lockedUntil }), decision: "blocked", internal: { lookupId: input.lookup_id } };
      }
      current = { ...current, lockedUntil: undefined, failedCodeTries: 0, state: current.state === "locked_out" ? "code_sent" : current.state };
      await store.saveCall(current);
    }
    const lookup = await findLookup(current, input.lookup_id);
    // The patient's own lockout comes first, whichever call the wrong codes were on.
    const patientFailures = lookup?.patientId ? await failedCodesFor(lookup.patientId) : [];
    const patientLock = lookup?.patientId ? patientLockedUntil(patientFailures, now) : undefined;
    if (patientLock) {
      return { result: ok<"check_code">({ locked_until: patientLock }), decision: "blocked", internal: { lookupId: input.lookup_id, patientId: lookup?.patientId ?? undefined } };
    }
    const sent = (await store.listRecord(current.id))
      .filter((e) => internalOf(e)?.lookupId === input.lookup_id && internalOf(e)?.codeHash)
      .at(-1);
    const codeFresh = sent && isFresh(sent.at, now, CODE_VALID_MS);
    const codeRight = lookup?.patientId && codeFresh && internalOf(sent)?.codeHash === hashCode(input.lookup_id, input.code.trim());
    // An outbound call confirms the date of birth with the code (SPEC Part 2, outbound step 2):
    // without one, or with a wrong one, it's a failed try. Inbound calls check a dob only when given.
    let dobRight = current.direction !== "outbound";
    if (codeRight && input.dob !== undefined) {
      const p = await store.getPatient(lookup!.patientId!);
      dobRight = normaliseDob(input.dob) === p?.dob;
    }
    const right = codeRight && dobRight;

    if (right && lookup?.patientId) {
      if (current.lockedPatientId && current.lockedPatientId !== lookup.patientId) {
        return blocked("not_yours", ["1"], { lookupId: input.lookup_id, patientId: current.lockedPatientId });
      }
      await store.saveCall({ ...current, state: "verified", lockedPatientId: lookup.patientId });
      const p = await store.getPatient(lookup.patientId);
      const prescriptions = (await store.getPrescriptions(lookup.patientId)).map((r) => ({ rx_id: r.id, drug: r.drug }));
      return {
        result: ok<"check_code">({ verified: true, patient_first_name: p?.firstName ?? "", prescriptions }),
        decision: "allowed",
        internal: { lookupId: input.lookup_id, patientId: lookup.patientId },
      };
    }

    const tries = current.failedCodeTries + 1;
    const internal = { lookupId: input.lookup_id, patientId: lookup?.patientId ?? undefined, ...(lookup?.patientId ? { codeFailed: true } : {}) };
    // This wrong code counts against the patient too: it may be their third in 15 minutes.
    const lockNow = lookup?.patientId ? patientLockedUntil([...patientFailures, now], now) : undefined;
    if (tries >= MAX_CODE_TRIES || lockNow) {
      const until = lockNow && tries < MAX_CODE_TRIES ? lockNow : addMs(now, LOCKOUT_MS);
      await store.saveCall({ ...current, state: current.state === "verified" ? "verified" : "locked_out", failedCodeTries: tries, lockedUntil: until });
      return { result: ok<"check_code">({ locked_until: until }), decision: "blocked", internal };
    }
    await store.saveCall({ ...current, failedCodeTries: tries });
    const patientLeft = lookup?.patientId
      ? MAX_CODE_TRIES - [...patientFailures, now].filter((at) => within(at, now, LOCKOUT_MS)).length
      : MAX_CODE_TRIES;
    return { result: ok<"check_code">({ verified: false, tries_left: Math.min(MAX_CODE_TRIES - tries, patientLeft) }), decision: "blocked", internal };
  }

  async function refillVerdict(call: Call, patient: Patient, rx: Prescription, reason?: string) {
    const context = await loadContext(store, patient, rx, call, reason);
    return { context, verdict: evaluate(await store.listCards(), "request_refill", context) };
  }

  async function checkPrescription(call: Call, input: ButtonInputs["check_prescription"]): Promise<Handled> {
    const rx = await ownRx(call, input.rx_id);
    const patient = await lockedPatient(call);
    if (!rx || !patient) return blocked("not_yours", ["1"], { patientId: call.lockedPatientId });
    const now = await store.now();
    const { verdict, context } = await refillVerdict(call, patient, rx);
    const others = (await store.getPrescriptions(patient.id)).filter((r) => r.id !== rx.id);
    let othersRefillable = 0;
    for (const o of others) if ((await refillVerdict(call, patient, o)).verdict.outcome !== "refuse") othersRefillable++;
    return {
      result: ok<"check_prescription">({
        rx_id: rx.id,
        drug: rx.drug,
        status: isBefore(rx.expiry, now) || rx.expiry === now ? "expired" : "active",
        refills_left: rx.refillsLeft,
        expiry: rx.expiry,
        last_fill: rx.lastFill,
        ...lastFillFacts(rx),
        refillable_today: verdict.outcome !== "refuse",
        others_refillable_count: othersRefillable,
        ...(input.include_other_names ? { other_names: others.map((o) => o.drug) } : {}),
      }),
      decision: "allowed",
      internal: { patientId: patient.id, rxId: rx.id },
      context,
    };
  }

  async function readLabel(call: Call, input: ButtonInputs["read_label"]): Promise<Handled> {
    const rx = await ownRx(call, input.rx_id);
    if (!rx) return blocked("not_yours", ["1"], { patientId: call.lockedPatientId });
    return { result: ok<"read_label">({ label_text: rx.labelText }), decision: "allowed", internal: { patientId: rx.patientId, rxId: rx.id } };
  }

  async function checkCoverage(call: Call, input: ButtonInputs["check_coverage"]): Promise<Handled> {
    const rx = await ownRx(call, input.rx_id);
    if (!rx) return blocked("not_yours", ["1"], { patientId: call.lockedPatientId });
    return {
      result: ok<"check_coverage">(coverageFacts(rx, input.days_supply)),
      decision: "allowed",
      internal: { patientId: rx.patientId, rxId: rx.id },
    };
  }

  function appointmentOffer(slot: AppointmentSlot) {
    return { slot_id: slot.id, slot_label: slot.label, availability_text: `The pharmacist has an appointment available on ${slot.label}.` };
  }

  function appointmentConfirmation(slot: AppointmentSlot) {
    return {
      slot_id: slot.id, slot_label: slot.label, appointment_id: `appt_${slot.id}`,
      confirmation_text: `Your pharmacist appointment is booked for ${slot.label}.`,
    };
  }

  async function appointmentStatus(patientId: string) {
    const [policy, reservations, now] = await Promise.all([store.policy(), store.listAppointments(), store.now()]);
    const upcoming = (policy.appointmentSlots ?? []).filter((slot) => isBefore(now, slot.start));
    const booked = new Map(reservations.map((r) => [r.slotId, r.patientId]));
    return {
      appointment_slots: upcoming.filter((s) => !booked.has(s.id)).map(appointmentOffer),
      appointments: upcoming.filter((s) => booked.get(s.id) === patientId).map(appointmentConfirmation),
    };
  }

  async function bookAppointment(call: Call, slotId: string, patientId: string): Promise<Handled> {
    const [policy, now, record] = await Promise.all([store.policy(), store.now(), store.listRecord(call.id)]);
    const slot = policy.appointmentSlots?.find((s) => s.id === slotId && isBefore(now, s.start));
    if (!slot) return blocked("invalid_input");
    const seen = record.some((entry) => {
      if (entry.button !== "order_status" || internalOf(entry)?.patientId !== patientId) return false;
      const result = resultOf(entry) as ButtonResult<"order_status"> | undefined;
      return result?.ok && [...(result.output.appointment_slots ?? []), ...(result.output.appointments ?? [])].some((s) => s.slot_id === slotId);
    });
    if (!seen) return blocked("invalid_input");
    const previous = (await store.listAppointments()).find((a) => a.slotId === slotId);
    if (previous?.patientId !== patientId) {
      // Only the actual caller's reply to the spoken offer can authorize this slot.
      // A blocked offer or question cannot establish consent.
      const [offer, question, reply] = record.filter((e) =>
        e.kind === "line_spoken" || e.kind === "line_blocked" || e.kind === "caller_line"
      ).slice(-3);
      const textOf = (e: typeof offer | undefined) => (e?.input as { text?: string } | undefined)?.text ?? "";
      if (offer?.kind !== "line_spoken" || textOf(offer) !== appointmentOffer(slot).availability_text
        || question?.kind !== "line_spoken" || textOf(question) !== APPOINTMENT_CONFIRMATION_QUESTION
        || reply?.kind !== "caller_line" || reply.actor !== "caller" || !confirmsBooking(textOf(reply))) {
        return blocked("refused");
      }
    }
    const reserved = await store.reserveAppointment({ slotId, patientId, bookedAt: now });
    if (!reserved) return blocked("refused");
    return { result: ok<"note_for_pharmacist">(appointmentConfirmation(slot)), decision: "allowed", internal: { patientId } };
  }

  async function orderStatus(call: Call, input: ButtonInputs["order_status"]): Promise<Handled> {
    const slots = await store.listSlots();
    const orders = await store.listOrders(call.lockedPatientId);
    return {
      result: ok<"order_status">({
        ...(input.include_appointments && call.lockedPatientId ? await appointmentStatus(call.lockedPatientId) : {}),
        orders: orders.map((o) => ({
          order_id: o.id,
          rx_id: o.rxId,
          status: o.state,
          ...(o.daysSupply !== undefined ? { days_supply: o.daysSupply } : {}),
          ...(o.slotId ? { slot_id: o.slotId, slot_label: slots.find((s) => s.id === o.slotId)?.label } : {}),
          ...(READY_STATES.has(o.state) ? { ready_label: readyDay(o.createdAt) } : {}),
        })),
      }),
      decision: "allowed",
      internal: { patientId: call.lockedPatientId },
    };
  }

  function refillMessage(state: string, ruleIds: RuleId[]): string {
    if (state === "queued") return "Refill queued.";
    if (state === "waiting_for_pharmacist") return "A pharmacist needs to check this refill before it is approved.";
    if (ruleIds.includes("2a") || ruleIds.includes("2b")) return "This prescription can't be refilled. A renewal can be requested.";
    if (ruleIds.includes("4b")) return "It is too early to refill this prescription.";
    return "This refill can't be done by phone.";
  }

  async function requestRefill(call: Call, input: ButtonInputs["request_refill"]): Promise<Handled> {
    const rx = await ownRx(call, input.rx_id);
    const patient = await lockedPatient(call);
    if (!rx || !patient) return blocked("not_yours", ["1"], { patientId: call.lockedPatientId });

    const daysSupply = input.days_supply ?? rx.daysSupplied;
    if (daysSupply > rx.daysSupplied) return blocked("invalid_input");
    const open = (await store.listOrders(patient.id)).find(
      (o) => o.rxId === rx.id && (o.state === "queued" || o.state === "waiting_for_pharmacist" || o.state === "approved"),
    );
    if (open) {
      // Older orders predate supply selection and used the full prescription supply.
      const existingDays = open.daysSupply ?? rx.daysSupplied;
      return {
        result: ok<"request_refill">({
          state: open.state,
          rule_ids: [],
          message: "This refill was already requested.",
          order_id: open.id,
          days_supply: existingDays,
          supply_text: `Your existing refill request is for a ${existingDays}-day supply.`,
          ...(READY_STATES.has(open.state) ? { ready_label: readyDay(open.createdAt) } : {}),
        }),
        decision: "allowed",
        internal: { patientId: patient.id, rxId: rx.id, orderId: open.id },
      };
    }

    const { verdict, context } = await refillVerdict(call, patient, rx, input.reason);
    const internal = { patientId: patient.id, rxId: rx.id };
    if (verdict.outcome === "refuse") {
      return {
        result: ok<"request_refill">({ state: "refused", rule_ids: verdict.deciding, message: refillMessage("refused", verdict.deciding) }, verdict.deciding),
        decision: "blocked",
        internal,
        context,
      };
    }

    const signals = [...new Set([...signalsFromCards(verdict), ...(await callSignals(call))])];
    const lane = chooseLane(verdict, signals);
    const state = lane === "automatic" ? "queued" : "waiting_for_pharmacist";
    const ruleIds = verdict.matched.map((m) => m.id);
    const now = await store.now();
    // A new id if this call already has an order for this prescription (e.g. one the
    // pharmacist denied), so the old order and its decision are never overwritten.
    const taken = new Set((await store.listOrders()).map((o) => o.id));
    let orderId = `o_${call.id}_${rx.id}`;
    for (let n = 2; taken.has(orderId); n++) orderId = `o_${call.id}_${rx.id}_${n}`;
    const order = await store.saveOrder({ id: orderId, rxId: rx.id, patientId: patient.id, state, daysSupply, createdAt: now });
    const item = await addItem({
      callId: call.id,
      patientId: patient.id,
      rxId: rx.id,
      orderId: order.id,
      kind: "refill",
      requestedDaysSupply: daysSupply,
      lane,
      ruleIds,
      signals,
      notes: [],
      ...(input.reason ? { aiView: input.reason } : {}),
    });
    return {
      result: ok<"request_refill">(
        {
          state,
          rule_ids: ruleIds,
          message: refillMessage(state, ruleIds),
          days_supply: daysSupply,
          supply_text: `Your refill request is for a ${daysSupply}-day supply.`,
          order_id: order.id,
          ...(READY_STATES.has(state) ? { ready_label: readyDay(now) } : {}),
        },
        ruleIds,
        lane,
      ),
      decision: lane === "automatic" ? "allowed" : verdict.outcome === "flag" ? "flagged" : "routed",
      internal: { ...internal, orderId: order.id, queueItemId: item.id },
      context,
    };
  }

  async function requestRenewal(call: Call, input: ButtonInputs["request_renewal"]): Promise<Handled> {
    const rx = await ownRx(call, input.rx_id);
    const patient = await lockedPatient(call);
    if (!rx || !patient) return blocked("not_yours", ["1"], { patientId: call.lockedPatientId });
    const context = await loadContext(store, patient, rx, call);
    const verdict: Verdict = evaluate(await store.listCards(), "request_renewal", context);
    const internal = { patientId: patient.id, rxId: rx.id };
    if (verdict.outcome === "refuse") {
      return { result: ok<"request_renewal">({ state: "refused", rule_ids: verdict.deciding }, verdict.deciding), decision: "blocked", internal, context };
    }
    if (verdict.outcome === "route") {
      const item = await addItem({
        callId: call.id,
        patientId: patient.id,
        rxId: rx.id,
        kind: "renewal",
        lane: "review",
        ruleIds: verdict.deciding,
        signals: signalsFromCards(verdict),
        notes: [],
      });
      return {
        result: ok<"request_renewal">({ state: "waiting_for_pharmacist", rule_ids: verdict.deciding }, verdict.deciding, "review"),
        decision: "routed",
        internal: { ...internal, queueItemId: item.id },
        context,
      };
    }
    return { result: ok<"request_renewal">({ state: "requested", rule_ids: [] }), decision: "allowed", internal, context };
  }

  async function setDelivery(call: Call, input: ButtonInputs["set_delivery"]): Promise<Handled> {
    const patient = await lockedPatient(call);
    if (!patient) return blocked("not_verified", ["1"]);
    const order = (await store.listOrders(patient.id)).find((o) => o.id === input.order_id);
    if (!order) return blocked("not_yours", ["1"], { patientId: patient.id });
    if (order.state === "refused" || order.state === "denied") return blocked("refused", [], { patientId: patient.id, orderId: order.id });
    if (!(await store.listSlots()).some((s) => s.id === input.slot_id)) return blocked("invalid_input", [], { patientId: patient.id });
    const rx = await store.getPrescription(order.rxId);
    const internal = { patientId: patient.id, rxId: order.rxId, orderId: order.id };

    // Core rule 5: pickup or an address already on file. No button accepts address text.
    const onFile = input.address_id === "pickup" || patient.addresses.some((a) => a.id === input.address_id);
    if (!onFile) {
      const item = await addItem({
        callId: call.id,
        patientId: patient.id,
        rxId: order.rxId,
        orderId: order.id,
        kind: "delivery",
        lane: "review",
        ruleIds: ["5"],
        signals: ["new_address"],
        notes: [],
      });
      return { result: ok<"set_delivery">({ ok: false, rule_ids: ["5"] }, ["5"], "review"), decision: "routed", internal: { ...internal, queueItemId: item.id } };
    }

    if (rx) {
      const context = await loadContext(store, patient, rx, call);
      const verdict = evaluate(await store.listCards(), "set_delivery", context);
      if (verdict.outcome === "refuse" || verdict.outcome === "route") {
        const item = await addItem({
          callId: call.id,
          patientId: patient.id,
          rxId: rx.id,
          orderId: order.id,
          kind: "delivery",
          lane: "review",
          ruleIds: verdict.deciding,
          signals: signalsFromCards(verdict),
          notes: [],
        });
        return {
          result: ok<"set_delivery">({ ok: false, rule_ids: verdict.deciding }, verdict.deciding, "review"),
          decision: verdict.outcome === "refuse" ? "blocked" : "routed",
          internal: { ...internal, queueItemId: item.id },
          context,
        };
      }
    }

    await store.saveOrder({ ...order, slotId: input.slot_id, addressId: input.address_id });
    return { result: ok<"set_delivery">({ ok: true, rule_ids: [] }), decision: "allowed", internal };
  }

  async function noteForPharmacist(call: Call, input: ButtonInputs["note_for_pharmacist"]): Promise<Handled> {
    const patient = await lockedPatient(call);
    if (!patient) return blocked("not_verified", ["1"]);
    if (input.kind === "appointment") return bookAppointment(call, input.slot_id, patient.id);
    if (input.rx_id !== undefined && !(await ownRx(call, input.rx_id))) return blocked("not_yours", ["1"], { patientId: patient.id });
    const noteId = `n_${call.id}_${(await store.queue()).length + 1}`;
    const note = { id: noteId, kind: input.kind, text: input.text };

    // A side effect moves this call's open refill (for that prescription, if named) to Review,
    // with the note on it (SPEC inbound step 8), instead of leaving it in Quick check.
    if (input.kind === "side_effect") {
      const refills = (await store.queue()).filter(
        (q) => q.status === "open" && q.kind === "refill" && q.callId === call.id && (input.rx_id === undefined || q.rxId === input.rx_id),
      );
      for (const q of refills) {
        const moved = await store.updateQueueItem(q.id, {
          lane: "review",
          signals: q.signals.includes("side_effect") ? q.signals : [...q.signals, "side_effect"],
          notes: [...q.notes, note],
        });
        send({ type: "queue", item: moved });
      }
      if (refills.length > 0) {
        return {
          result: ok<"note_for_pharmacist">({ note_id: noteId }, [], "review"),
          decision: "allowed",
          internal: { patientId: patient.id, rxId: input.rx_id, queueItemId: refills[0].id },
        };
      }
    }

    const item = await addItem({
      callId: call.id,
      patientId: patient.id,
      ...(input.rx_id ? { rxId: input.rx_id } : {}),
      kind: "note",
      lane: "review",
      ruleIds: [],
      signals: input.kind === "side_effect" ? ["side_effect"] : [],
      notes: [note],
    });
    return {
      result: ok<"note_for_pharmacist">({ note_id: noteId }, [], "review"),
      decision: "allowed",
      internal: { patientId: patient.id, rxId: input.rx_id, queueItemId: item.id },
    };
  }

  async function escalate(call: Call, input: ButtonInputs["escalate"]): Promise<Handled> {
    const patientId = call.lockedPatientId ?? call.targetPatientId ?? "unknown";
    const item = await addItem({
      callId: call.id,
      patientId,
      kind: "escalation",
      lane: "review",
      ruleIds: [],
      signals: [],
      notes: [{ id: `n_${call.id}_esc`, kind: "question", text: input.reason }],
    });
    return { result: ok<"escalate">({ flag_id: `f_${item.id}` }, [], "review"), decision: "allowed", internal: { patientId, queueItemId: item.id } };
  }

  async function run(call: Call | undefined, button: ButtonName, input: unknown): Promise<Handled> {
    if (!call) return blocked("not_found");
    if (call.state === "ended") return blocked("call_ended");
    // Core rule 1 first: an unverified call gets not_verified whatever it sends.
    if (NEEDS_VERIFIED.includes(button) && call.state !== "verified") return blocked("not_verified", ["1"]);
    const checked = checkInput(button, input);
    if (!checked.ok) return blocked("invalid_input");
    const i = checked.input as never;
    switch (button) {
      case "lookup_patient":
        return lookupPatient(call, i);
      case "send_code":
        return sendCode(call, i);
      case "check_code":
        return checkCode(call, i);
      case "check_prescription":
        return checkPrescription(call, i);
      case "read_label":
        return readLabel(call, i);
      case "check_coverage":
        return checkCoverage(call, i);
      case "order_status":
        return orderStatus(call, i);
      case "request_refill":
        return requestRefill(call, i);
      case "request_renewal":
        return requestRenewal(call, i);
      case "set_delivery":
        return setDelivery(call, i);
      case "note_for_pharmacist":
        return noteForPharmacist(call, i);
      case "escalate":
        return escalate(call, i);
      default:
        return blocked("invalid_input");
    }
  }

  // What a press announces or remembers outside the store (stream events, the live code) is held,
  // per press, until its record entry is written (see press). AsyncLocalStorage keeps each press's
  // list its own when presses on different calls overlap.
  const held = new AsyncLocalStorage<(() => void)[]>();
  const afterRecord = (action: () => void) => {
    const list = held.getStore();
    if (list) list.push(action);
    else action();
  };
  const send = (event: StreamEvent) => afterRecord(() => emit(event));

  const toPressDecision = (d: RecordDecision): PressDecision => (d === "blocked" ? "refused" : d);

  const press: PressFn = async (callId, button, input) => {
    // The press and its record entry are all or nothing (AUDIT fix 4b): inside store.transaction a
    // failed record write undoes the order, queue item or code the button made. Events the button
    // would announce are held, and go out only once its record entry is written.
    const pending: (() => void)[] = [];
    const attempt = async (): Promise<Handled> => {
      let handled: Handled;
      try {
        handled = await run(await store.getCall(callId), button, input);
      } catch {
        handled = blocked("refused");
      }
      const { result, decision, internal = {}, context } = handled;
      const lane = result.ok ? result.lane : undefined;
      const output: PressRecordOutput = { result, internal };
      await store.appendRecord({
        callId,
        actor: "agent",
        kind: "button",
        button,
        input,
        output,
        ...(context ? { context } : {}),
        ruleIds: result.ruleIds,
        decision,
        ...(lane ? { lane } : {}),
      });
      return handled;
    };
    let handled: Handled;
    try {
      handled = await held.run(pending, () => (store.transaction ? store.transaction(attempt) : attempt()));
    } catch {
      // A press that can't be recorded must not succeed, and announces nothing.
      return err("refused") as never;
    }
    for (const action of pending) action();
    const { result, decision } = handled;
    const lane = result.ok ? result.lane : undefined;
    emit({ type: "press", callId, button, decision: toPressDecision(decision), ruleIds: result.ruleIds, ...(lane ? { lane } : {}) });
    return result as never;
  };

  // ---------- Calls ----------

  /** Start an inbound call. Outbound calls must go through startOutboundCall (rule 7). */
  async function startInboundCall(): Promise<CallId> {
    const n = (await store.listRecord()).filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start").length + 1;
    const id = `${callIdPrefix}${String(n).padStart(4, "0")}`;
    const now = await store.now();
    await store.saveCall({ id, direction: "inbound", state: "greeting", startedAt: now, failedCodeTries: 0, callerSaid: [] });
    await store.appendRecord({ callId: id, actor: "system", kind: "safety", input: { check: "call_start", direction: "inbound" }, decision: "allowed" });
    return id;
  }

  /** Rule 7: may we ring this patient about this prescription right now? Writes the decision to the record. */
  async function checkOutbound(patientId: string, rxId: string): Promise<{ allowed: boolean; ruleIds: RuleId[] }> {
    const patient = await store.getPatient(patientId);
    const rx = await store.getPrescription(rxId);
    if (!patient || !rx || rx.patientId !== patientId) {
      await store.appendRecord({ actor: "system", kind: "safety", input: { check: "outbound", patient_id: patientId, rx_id: rxId }, ruleIds: ["7"], decision: "blocked" });
      return { allowed: false, ruleIds: ["7"] };
    }
    const context = await loadContext(store, patient, rx);
    const verdict = evaluate(await store.listCards(), "outbound_check", context);
    const allowed = verdict.outcome === "allowed" || verdict.outcome === "flag";
    await store.appendRecord({
      actor: "system",
      kind: "safety",
      input: { check: "outbound", patient_id: patientId, rx_id: rxId },
      context,
      ruleIds: verdict.deciding,
      decision: allowed ? "allowed" : "blocked",
    });
    return { allowed, ruleIds: verdict.deciding };
  }

  /** Start an outbound call only if rule 7 allows it. The call starts at code_sent. */
  async function startOutboundCall(patientId: string, rxId: string): Promise<{ ok: true; callId: CallId; lookupId: string } | { ok: false; ruleIds: RuleId[] }> {
    const check = await checkOutbound(patientId, rxId);
    if (!check.allowed) return { ok: false, ruleIds: check.ruleIds };
    const n = (await store.listRecord()).filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start").length + 1;
    const id = `${callIdPrefix}${String(n).padStart(4, "0")}`;
    const now = await store.now();
    await store.saveCall({ id, direction: "outbound", state: "code_sent", targetPatientId: patientId, startedAt: now, failedCodeTries: 0, callerSaid: [] });
    await store.appendRecord({ callId: id, actor: "system", kind: "safety", input: { check: "call_start", direction: "outbound", rx_id: rxId }, decision: "allowed" });
    return { ok: true, callId: id, lookupId: outboundLookupId(id) };
  }

  /** startCall for an AgentDriver: inbound only, or outbound with a prescription. */
  async function startCall(opts: StartCallOpts & { rxId?: string }): Promise<CallId> {
    if (opts.direction === "inbound") return startInboundCall();
    if (!opts.patientId || !opts.rxId) throw new Error("outbound calls need patientId and rxId (rule 7)");
    const started = await startOutboundCall(opts.patientId, opts.rxId);
    if (!started.ok) throw new Error(`outbound call refused by rule ${started.ruleIds.join(", ")}`);
    return started.callId;
  }

  async function endCall(callId: CallId): Promise<void> {
    const call = await store.getCall(callId);
    if (call && call.state !== "ended") await store.saveCall({ ...call, state: "ended", endedAt: await store.now() });
  }

  /**
   * The latest code sent on this call, for that call's phone only (the server route that
   * serves it must check the caller is that phone). Undefined once the code is stale:
   * a newer code, a reset store, or the code's 10 minutes have passed.
   */
  async function codeFor(callId: CallId): Promise<string | undefined> {
    const sent = sentCodes.get(callId);
    if (!sent) return undefined;
    const entry = (await store.listRecord(callId)).filter((e) => internalOf(e)?.codeHash).at(-1);
    if (!entry || internalOf(entry)?.codeHash !== sent.hash || !isFresh(entry.at, await store.now(), CODE_VALID_MS)) return undefined;
    return sent.code;
  }

  return { press, startCall, startInboundCall, startOutboundCall, checkOutbound, endCall, codeFor };
}

export type Control = ReturnType<typeof createControl>;

/** For tests and the hammers: the last result recorded for a call. */
export async function lastResult(store: Store, callId: CallId): Promise<ButtonResult | undefined> {
  const last = (await store.listRecord(callId)).filter((e) => e.kind === "button").at(-1);
  return last ? resultOf(last) : undefined;
}
