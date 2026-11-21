// The control layer: the only way the AI acts (SPEC Part 3). Every press is checked,
// decided in code, written to the hash-chained record and emitted as a "press" event.
// press() never throws to the agent.

import { createHash, randomInt } from "node:crypto";
import {
  NEEDS_VERIFIED,
  type ButtonError,
  type ButtonInputs,
  type ButtonName,
  type ButtonResult,
  type Call,
  type CallId,
  type EmitFn,
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
import { internalOf, loadContext, resultOf, type PressRecordOutput } from "./context";
import { evaluate, type Verdict } from "./engine";
import { chooseLane, signalsFromCards } from "./lanes";
import { addMs, fresh as isFresh, isBefore, MINUTE_MS, within } from "./time";
import { checkInput, normalise, normaliseDob, normaliseRxNumber } from "./validate";

export const MAX_CODE_TRIES = 3;
export const LOCKOUT_MS = 15 * MINUTE_MS;
export const CODE_VALID_MS = 10 * MINUTE_MS;
export const MAX_CODES_PER_HOUR = 3;

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
};

export const CODE_SENT_TEXT = "A verification code was sent to your phone.";

type Handled = {
  result: ButtonResult;
  decision: RecordDecision;
  internal?: PressRecordOutput["internal"];
  context?: RuleContext;
};

const hashCode = (lookupId: string, code: string) => createHash("sha256").update(`${lookupId}:${code}`).digest("hex");

export function createControl({ store, emit = () => {}, makeCode, broadcastCodes = false }: ControlOptions) {
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
    emit({ type: "queue", item: saved });
    return saved;
  }

  /** Signals from this call so far: failed codes, speech-guard replacements, safety words, side effects. */
  async function callSignals(call: Call): Promise<Signal[]> {
    const record = await store.listRecord(call.id);
    const signals = new Set<Signal>();
    if (call.failedCodeTries > 0 || record.some((e) => e.button === "check_code" && e.decision === "blocked")) signals.add("failed_code_attempts");
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
    sentCodes.set(call.id, { code, hash: codeHash });
    const text = broadcastCodes ? `Your pharmacy verification code is ${code}.` : CODE_SENT_TEXT;
    emit({ type: "phone", callId: call.id, kind: "code", text });
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
    const sent = (await store.listRecord(current.id))
      .filter((e) => internalOf(e)?.lookupId === input.lookup_id && internalOf(e)?.codeHash)
      .at(-1);
    const codeFresh = sent && isFresh(sent.at, now, CODE_VALID_MS);
    const codeRight = lookup?.patientId && codeFresh && internalOf(sent)?.codeHash === hashCode(input.lookup_id, input.code.trim());
    // A date of birth, when given (outbound calls confirm it with the code), must match too.
    let dobRight = true;
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
    const internal = { lookupId: input.lookup_id, patientId: lookup?.patientId ?? undefined };
    if (tries >= MAX_CODE_TRIES) {
      const until = addMs(now, LOCKOUT_MS);
      await store.saveCall({ ...current, state: current.state === "verified" ? "verified" : "locked_out", failedCodeTries: tries, lockedUntil: until });
      return { result: ok<"check_code">({ locked_until: until }), decision: "blocked", internal };
    }
    await store.saveCall({ ...current, failedCodeTries: tries });
    return { result: ok<"check_code">({ verified: false, tries_left: MAX_CODE_TRIES - tries }), decision: "blocked", internal };
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
      result: ok<"check_coverage">({ plan_pays: rx.planPays, patient_pays: rx.patientPays }),
      decision: "allowed",
      internal: { patientId: rx.patientId, rxId: rx.id },
    };
  }

  async function orderStatus(call: Call): Promise<Handled> {
    const slots = await store.listSlots();
    const orders = await store.listOrders(call.lockedPatientId);
    return {
      result: ok<"order_status">({
        orders: orders.map((o) => ({
          order_id: o.id,
          rx_id: o.rxId,
          status: o.state,
          ...(o.slotId ? { slot_id: o.slotId, slot_label: slots.find((s) => s.id === o.slotId)?.label } : {}),
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

    const open = (await store.listOrders(patient.id)).find(
      (o) => o.rxId === rx.id && (o.state === "queued" || o.state === "waiting_for_pharmacist" || o.state === "approved"),
    );
    if (open) {
      return {
        result: ok<"request_refill">({ state: open.state, rule_ids: [], message: "This refill was already requested.", order_id: open.id }),
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
    const order = await store.saveOrder({ id: orderId, rxId: rx.id, patientId: patient.id, state, createdAt: now });
    const item = await addItem({
      callId: call.id,
      patientId: patient.id,
      rxId: rx.id,
      orderId: order.id,
      kind: "refill",
      lane,
      ruleIds,
      signals,
      notes: [],
      ...(input.reason ? { aiView: input.reason } : {}),
    });
    return {
      result: ok<"request_refill">({ state, rule_ids: ruleIds, message: refillMessage(state, ruleIds), order_id: order.id }, ruleIds, lane),
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
        emit({ type: "queue", item: moved });
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
        return orderStatus(call);
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

  const toPressDecision = (d: RecordDecision): PressDecision => (d === "blocked" ? "refused" : d);

  const press: PressFn = async (callId, button, input) => {
    let handled: Handled;
    try {
      handled = await run(await store.getCall(callId), button, input);
    } catch {
      handled = blocked("refused");
    }
    const { result, decision, internal = {}, context } = handled;
    const lane = result.ok ? result.lane : undefined;
    try {
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
    } catch {
      // A press that can't be recorded must not succeed.
      return err("refused") as never;
    }
    emit({ type: "press", callId, button, decision: toPressDecision(decision), ruleIds: result.ruleIds, ...(lane ? { lane } : {}) });
    return result as never;
  };

  // ---------- Calls ----------

  /** Start an inbound call. Outbound calls must go through startOutboundCall (rule 7). */
  async function startInboundCall(): Promise<CallId> {
    const n = (await store.listRecord()).filter((e) => e.kind === "safety" && (e.input as { check?: string })?.check === "call_start").length + 1;
    const id = `c_${String(n).padStart(4, "0")}`;
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
    const id = `c_${String(n).padStart(4, "0")}`;
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
