// FAKES. Build against these until the real parts land:
//   store → lib/store/memory.ts (4.2), press → lib/control (4.3),
//   guardSentence and checkCallerLine → lib/guard (4.4), driver → lib/agent (1.2).
// They are deliberately simple. The fake press does NOT run the rule engine, and the fake
// hash is not sha256. Never ship them, and never score a real result against them.
// All people, phones (555-01xx), addresses, dates and prices here are made up.

import { coverageFacts, lastFillFacts } from "./patient-facts";
import { STARTING_CARDS } from "./cards";
import type { ButtonInputs, ButtonName, ButtonResult, PressFn } from "./buttons";
import { NEEDS_VERIFIED } from "./buttons";
import type { AgentDriver, AgentEvent } from "./driver";
import type { EmitFn } from "./events";
import type { CheckCallerLineFn, GuardSentenceFn } from "./guard";
import { GUARD_REPLACEMENTS } from "./guard";
import type { CallId, Lane, PatientId, RuleId } from "./ids";
import type { LegacyAppointment, Call, Order, QueueItem, RecordEntry, Seed, Store } from "./store";

// ---------- Sam's data ----------

/** Tuesday 10 AM on the demo clock. */
export const DEMO_NOW = "2026-11-24T10:00:00-05:00";

/** The code the fake press accepts. The real one is random and sent to the phone page. */
export const FAKE_CODE = "246810";

export const SAM_ID: PatientId = "p_sam";
export const SAM_CONCERTA = "rx_sam_concerta";
export const SAM_METFORMIN = "rx_sam_metformin";

export const FAKE_SEED: Seed = {
  now: DEMO_NOW,
  pharmacyName: "Maple Street Pharmacy",
  patients: [
    {
      id: SAM_ID,
      firstName: "Sam",
      lastName: "Rivera",
      dob: "1990-03-14",
      phone: "555-0101",
      addresses: [{ id: "addr_sam_home", label: "Home", line1: "12 Elm Row", city: "London", postal: "N6A 0A1" }],
      optedInToCalls: true,
      flags: [],
      householdPatientIds: [],
    },
  ],
  prescriptions: [
    {
      id: SAM_CONCERTA,
      patientId: SAM_ID,
      rxNumber: "RX-100201",
      drug: "Concerta",
      drugClass: "stimulant",
      strength: "36 mg",
      controlled: true,
      daysSupplied: 30,
      prescribedIntervalDays: 30,
      // 27 days before DEMO_NOW: runs out Friday, passes rules 3 and 4b on Tuesday.
      lastFill: "2026-10-28T10:00:00-04:00",
      refillsLeft: 2,
      refillsTotal: 2,
      expiry: "2027-04-28T00:00:00-04:00",
      lastDispensedQuantity: { count: 30, unit: "tablets" },
      labelText: "CONCERTA 36 MG TABLET. Take 1 tablet by mouth every morning. Qty 30.",
      planPays: "$41.20",
      patientPays: "$4.10",
    },
    {
      id: SAM_METFORMIN,
      patientId: SAM_ID,
      rxNumber: "RX-100202",
      drug: "Metformin",
      drugClass: "biguanide",
      strength: "500 mg",
      controlled: false,
      daysSupplied: 90,
      prescribedIntervalDays: 90,
      lastFill: "2026-10-01T10:00:00-04:00",
      refillsLeft: 3,
      refillsTotal: 3,
      expiry: "2027-09-01T00:00:00-04:00",
      lastDispensedQuantity: { count: 180, unit: "tablets" },
      labelText: "METFORMIN 500 MG TABLET. Take 1 tablet by mouth twice a day with meals. Qty 180.",
      planPays: "$12.60",
      patientPays: "$2.00",
    },
  ],
  slots: [
    { id: "slot_thu_am", label: "Thursday 9 to 12", start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T12:00:00-05:00" },
    { id: "slot_thu_pm", label: "Thursday 1 to 5", start: "2026-11-26T13:00:00-05:00", end: "2026-11-26T17:00:00-05:00" },
  ],
  orders: [],
  cards: STARTING_CARDS,
  policy: { controlledEarlyWindowDays: 3 },
};

// ---------- Fake store ----------

/** NOT sha256. A tiny string hash so the fake chain links. The real store uses sha256. */
function fakeHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fake_${h.toString(16).padStart(8, "0")}`;
}

const clone = <T>(value: T): T => structuredClone(value);

export function createFakeStore(seed: Seed = FAKE_SEED): Store {
  let data = clone(seed);
  let now = seed.now;
  let calls = new Map<CallId, Call>();
  const appointments = new Map<string, LegacyAppointment>();
  let record: RecordEntry[] = [];
  let queueItems: QueueItem[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  const store: Store = {
    async now() {
      return now;
    },
    async setNow(value) {
      now = value;
    },
    async getPatient(id) {
      return clone(data.patients.find((p) => p.id === id));
    },
    async listPatients() {
      return clone(data.patients);
    },
    async getPrescriptions(patientId) {
      return clone(data.prescriptions.filter((rx) => rx.patientId === patientId));
    },
    async getPrescription(rxId) {
      return clone(data.prescriptions.find((rx) => rx.id === rxId));
    },
    async listSlots() {
      return clone(data.slots);
    },
    async listAppointments() {
      return clone([...appointments.values()]);
    },
    async reserveAppointment(appointment) {
      const existing = appointments.get(appointment.slotId);
      if (existing) return existing.patientId === appointment.patientId;
      appointments.set(appointment.slotId, clone(appointment));
      return true;
    },
    async listOrders(patientId) {
      return clone(data.orders.filter((o) => !patientId || o.patientId === patientId));
    },
    async saveOrder(order) {
      data.orders = [...data.orders.filter((o) => o.id !== order.id), clone(order)];
      return clone(order);
    },
    async listCards() {
      return clone(data.cards);
    },
    async addCard(card) {
      if (data.cards.some((c) => c.id === card.id)) throw new Error(`rule card ${card.id} already exists`);
      data.cards = [...data.cards, clone(card)];
      return clone(card);
    },
    async policy() {
      return clone(data.policy);
    },
    async getCall(id) {
      return clone(calls.get(id));
    },
    async saveCall(call) {
      calls.set(call.id, clone(call));
      return clone(call);
    },
    async appendRecord(input) {
      const prevHash = record.at(-1)?.hash ?? "genesis";
      const body = { ...clone(input), id: nextId("e"), seq: record.length + 1, at: now, prevHash };
      const entry: RecordEntry = { ...body, hash: fakeHash(prevHash + JSON.stringify(body)) };
      record.push(entry);
      return clone(entry);
    },
    async listRecord(callId) {
      return clone(record.filter((e) => !callId || e.callId === callId));
    },
    async addQueueItem(item) {
      const full: QueueItem = { ...clone(item), id: nextId("q"), status: "open", createdAt: now };
      queueItems.push(full);
      return clone(full);
    },
    async queue(lane) {
      return clone(queueItems.filter((q) => !lane || q.lane === lane));
    },
    async updateQueueItem(itemId, patch) {
      const item = queueItems.find((q) => q.id === itemId);
      if (!item || item.status !== "open") throw new Error(`no open queue item ${itemId}`);
      Object.assign(item, clone(patch));
      return clone(item);
    },
    async decide(itemId, decision, approver, note) {
      const item = queueItems.find((q) => q.id === itemId);
      if (!item) throw new Error(`no queue item ${itemId}`);
      item.status = decision === "approve" ? "approved" : "denied";
      item.decidedBy = clone(approver);
      item.decidedAt = now;
      item.decisionNote = note;
      if (item.orderId) {
        const order = data.orders.find((o) => o.id === item.orderId);
        if (order) order.state = decision === "approve" ? "approved" : "denied";
      }
      await store.appendRecord({
        callId: item.callId,
        actor: approver.role,
        kind: "approval",
        input: { itemId, decision, note },
        decision: "allowed",
      });
      return clone(item);
    },
    async reset(next) {
      data = clone(next);
      appointments.clear();
      now = next.now;
      calls = new Map();
      record = [];
      queueItems = [];
      counter = 0;
    },
  };
  return store;
}

// ---------- Fake press (no rule engine) ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);

export function createFakePress(store: Store, emit: EmitFn = () => {}): PressFn {
  const lookups = new Map<string, PatientId | null>();

  async function run(call: Call, button: ButtonName, input: unknown): Promise<ButtonResult> {
    const fail = (error: Extract<ButtonResult, { ok: false }>["error"], ruleIds: RuleId[] = []): ButtonResult => ({
      ok: false,
      error,
      ruleIds,
    });
    const done = (output: unknown, ruleIds: RuleId[] = [], lane?: Lane) =>
      ({ ok: true, output, ruleIds, lane }) as ButtonResult;
    if (call.state === "ended") return fail("call_ended");
    if (NEEDS_VERIFIED.includes(button) && call.state !== "verified") return fail("not_verified", ["1"]);
    if (typeof input !== "object" || input === null) return fail("invalid_input");
    const patientId = call.lockedPatientId;
    const ownRx = async (rxId: unknown) => {
      const rx = typeof rxId === "string" ? await store.getPrescription(rxId) : undefined;
      return rx && rx.patientId === patientId ? rx : undefined;
    };

    switch (button) {
      case "lookup_patient": {
        const { name, dob, rx_number } = input as ButtonInputs["lookup_patient"];
        const patients = await store.listPatients();
        let match: PatientId | null = null;
        for (const p of patients) {
          const rxs = await store.getPrescriptions(p.id);
          const named = String(name ?? "").toLowerCase().includes(p.lastName.toLowerCase());
          if (named && dob === p.dob && rxs.some((rx) => rx.rxNumber === rx_number)) match = p.id;
        }
        const lookupId = `lk_${call.id}_${lookups.size + 1}`;
        lookups.set(lookupId, match);
        await store.saveCall({ ...call, state: "code_sent" });
        return done({ lookup_id: lookupId, message: "code sent if matched" });
      }
      case "send_code":
        return done({ message: "code sent if matched" });
      case "check_code": {
        const { lookup_id, code } = input as ButtonInputs["check_code"];
        if (call.lockedUntil && Date.parse(call.lockedUntil) > Date.parse(await store.now())) return done({ locked_until: call.lockedUntil });
        const match = lookups.get(lookup_id) ?? (call.direction === "outbound" ? call.targetPatientId : null);
        if (match && code === FAKE_CODE) {
          const p = await store.getPatient(match);
          await store.saveCall({ ...call, state: "verified", lockedPatientId: match, failedCodeTries: 0 });
          const prescriptions = (await store.getPrescriptions(match)).map((r) => ({ rx_id: r.id, drug: r.drug }));
          return done({ verified: true, patient_first_name: p?.firstName ?? "", prescriptions });
        }
        const tries = call.failedCodeTries + 1;
        if (tries >= 3) {
          const until = new Date(Date.parse(await store.now()) + 15 * 60 * 1000).toISOString();
          await store.saveCall({ ...call, state: "locked_out", failedCodeTries: tries, lockedUntil: until });
          return done({ locked_until: until });
        }
        await store.saveCall({ ...call, failedCodeTries: tries });
        return done({ verified: false, tries_left: 3 - tries });
      }
      case "check_prescription": {
        const { rx_id, include_other_names } = input as ButtonInputs["check_prescription"];
        const rx = await ownRx(rx_id);
        if (!rx) return fail("not_yours", ["1"]);
        const now = await store.now();
        const others = (await store.getPrescriptions(rx.patientId)).filter((o) => o.id !== rx.id);
        return done({
          rx_id: rx.id,
          drug: rx.drug,
          status: rx.expiry < now ? "expired" : "active",
          refills_left: rx.refillsLeft,
          expiry: rx.expiry,
          last_fill: rx.lastFill,
          ...lastFillFacts(rx),
          refillable_today: daysBetween(rx.lastFill, now) >= rx.daysSupplied * 0.8,
          others_refillable_count: others.length,
          ...(include_other_names ? { other_names: others.map((o) => o.drug) } : {}),
        });
      }
      case "read_label": {
        const rx = await ownRx((input as ButtonInputs["read_label"]).rx_id);
        return rx ? done({ label_text: rx.labelText }) : fail("not_yours", ["1"]);
      }
      case "check_coverage": {
        const rx = await ownRx((input as ButtonInputs["check_coverage"]).rx_id);
        return rx ? done(coverageFacts(rx, (input as ButtonInputs["check_coverage"]).days_supply)) : fail("not_yours", ["1"]);
      }
      case "order_status": {
        const slots = await store.listSlots();
        const orders = await store.listOrders(patientId);
        return done({
          orders: orders.map((o) => ({
            order_id: o.id,
            rx_id: o.rxId,
            status: o.state,
            slot_id: o.slotId,
            slot_label: slots.find((s) => s.id === o.slotId)?.label,
          })),
        });
      }
      case "request_refill": {
        const { rx_id, reason } = input as ButtonInputs["request_refill"];
        const rx = await ownRx(rx_id);
        if (!rx || !patientId) return fail("not_yours", ["1"]);
        // Fake: controlled → Quick check via rule 4, else Automatic. The real engine is lib/control.
        const ruleIds = rx.controlled ? ["4"] : [];
        const lane: Lane = rx.controlled ? "quick_check" : "automatic";
        const state = rx.controlled ? "waiting_for_pharmacist" : "queued";
        const order: Order = { id: `o_${call.id}_${rx.id}`, rxId: rx.id, patientId, state, createdAt: await store.now() };
        await store.saveOrder(order);
        if (rx.controlled) {
          const item = await store.addQueueItem({
            callId: call.id,
            patientId,
            rxId: rx.id,
            orderId: order.id,
            kind: "refill",
            lane,
            ruleIds,
            signals: [],
            notes: [],
            aiView: reason,
          });
          emit({ type: "queue", item });
        }
        const message = rx.controlled ? "A pharmacist will check it." : "Queued.";
        return done({ state, rule_ids: ruleIds, message, order_id: order.id }, ruleIds, lane);
      }
      case "request_renewal": {
        const rx = await ownRx((input as ButtonInputs["request_renewal"]).rx_id);
        if (!rx) return fail("not_yours", ["1"]);
        return rx.controlled
          ? done({ state: "waiting_for_pharmacist", rule_ids: ["8b"] }, ["8b"])
          : done({ state: "requested", rule_ids: [] });
      }
      case "set_delivery": {
        const { order_id, slot_id, address_id } = input as ButtonInputs["set_delivery"];
        const order = (await store.listOrders(patientId)).find((o) => o.id === order_id);
        if (!order) return fail("not_found");
        const patient = patientId ? await store.getPatient(patientId) : undefined;
        const onFile = address_id === "pickup" || patient?.addresses.some((a) => a.id === address_id);
        if (!onFile) return done({ ok: false, rule_ids: ["5"] }, ["5"]);
        await store.saveOrder({ ...order, slotId: slot_id, addressId: address_id });
        return done({ ok: true, rule_ids: [] });
      }
      case "note_for_pharmacist":
        return done({ note_id: `n_${call.id}_${Date.now()}` });
      case "escalate":
        return done({ flag_id: `f_${call.id}_${Date.now()}` });
      // Trail #85 fakes: shapes only. The real slots, bookings and rules are in lib/control.
      case "refill_history": {
        const rx = await ownRx((input as ButtonInputs["refill_history"]).rx_id);
        if (!rx) return fail("not_yours", ["1"]);
        return done({
          rx_id: rx.id,
          drug: rx.drug,
          last_fill: rx.lastFill,
          last_fill_day: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "long" }).format(new Date(rx.lastFill)),
          last_fill_quantity: rx.lastFillQuantity ?? Number(rx.labelText.match(/qty\.? ?(\d+)/i)?.[1] ?? 0),
          last_fill_unit: /capsule/i.test(rx.labelText) ? "capsule" : "tablet",
          last_fill_days_supply: rx.lastFillDaysSupply ?? rx.daysSupplied,
          ...(rx.lastFillMethod ? { last_fill_method: rx.lastFillMethod } : {}),
          refills_left: rx.refillsLeft,
          days_supply_prescribed: rx.daysSupplied,
          next_eligible: null,
          ...(rx.prescriber ? { prescriber: rx.prescriber } : {}),
        });
      }
      case "list_appointment_slots": {
        const { type } = input as ButtonInputs["list_appointment_slots"];
        return done({ type, slots: [{ slot_id: `ap_${type}_20261126_1000`, label: "Thursday the 26th at 10 AM", start: "2026-11-26T10:00:00-05:00", end: "2026-11-26T10:30:00-05:00" }], booked: [] });
      }
      case "book_appointment": {
        const { slot_id } = input as ButtonInputs["book_appointment"];
        if (!String(slot_id ?? "").startsWith("ap_")) return fail("not_found");
        return done({ ok: true, rule_ids: [], appointment_id: `apt_${call.id}_1`, label: "Thursday the 26th at 10 AM", start: "2026-11-26T10:00:00-05:00" });
      }
      case "cancel_appointment":
        return done({ ok: true, rule_ids: [] });
    }
  }

  return async function press(callId, button, input) {
    const call = await store.getCall(callId);
    const result: ButtonResult = call ? await run(call, button, input) : { ok: false, error: "not_found", ruleIds: [] };
    const decision = !result.ok ? "refused" : result.lane && result.lane !== "automatic" ? "routed" : "allowed";
    await store.appendRecord({
      callId,
      actor: "agent",
      kind: "button",
      button,
      input,
      output: result,
      ruleIds: result.ruleIds,
      decision: decision === "refused" ? "blocked" : decision,
      lane: result.ok ? result.lane : undefined,
    });
    emit({ type: "press", callId, button, decision, ruleIds: result.ruleIds, lane: result.ok ? result.lane : undefined });
    return result as never;
  };
}

// ---------- Fake guard and safety check ----------

/** Fake S1 only: before verification, blocks sentences naming any seeded patient or drug. */
export function createFakeGuard(store: Store, emit: EmitFn = () => {}): GuardSentenceFn {
  return async (callId, sentence) => {
    const call = await store.getCall(callId);
    if (call?.state !== "verified") {
      const words: string[] = [];
      for (const p of await store.listPatients()) {
        words.push(p.lastName);
        for (const rx of await store.getPrescriptions(p.id)) words.push(rx.drug, rx.rxNumber);
      }
      const lower = sentence.toLowerCase();
      if (words.some((w) => lower.includes(w.toLowerCase()))) {
        const replacement = GUARD_REPLACEMENTS.S1;
        emit({ type: "blocked_line", callId, rule: "S1", original: sentence, replacement });
        return { speak: replacement, blocked: true, rule: "S1", original: sentence };
      }
    }
    return { speak: sentence, blocked: false };
  };
}

/** Fake keyword check with a handful of words. The real list is lib/guard (4.4). */
export const fakeCheckCallerLine: CheckCallerLineFn = async (_callId, line) => {
  const text = line.toLowerCase();
  if (/(can't breathe|cannot breathe|chest pain|overdose|swelling)/.test(text))
    return { action: "emergency", script: "Please hang up and call 911 or poison control now." };
  if (/(kill myself|end my life|hurt myself)/.test(text))
    return { action: "crisis", script: "You can call or text 9-8-8 any time to reach the crisis line." };
  if (/(a person|a human|real person|the pharmacist)/.test(text))
    return { action: "handover", script: "I'll get a pharmacist for you now." };
  return { action: "continue" };
};

// ---------- Fake driver ----------

/** Answers every line with "One moment." through the guard. Presses nothing. */
export function createFakeDriver(store: Store, guard: GuardSentenceFn, emit: EmitFn = () => {}): AgentDriver {
  let n = 0;
  return {
    async startCall({ direction, patientId }) {
      const id = `c_fake_${++n}`;
      await store.saveCall({
        id,
        direction,
        state: direction === "outbound" ? "code_sent" : "greeting",
        targetPatientId: patientId,
        startedAt: await store.now(),
        failedCodeTries: 0,
        callerSaid: [],
      });
      return id;
    },
    async *callerSays(callId, text): AsyncIterable<AgentEvent> {
      emit({ type: "line", callId, who: "caller", text });
      const safety = await fakeCheckCallerLine(callId, text);
      if (safety.action !== "continue") {
        yield { type: "safety", result: safety };
        return;
      }
      const guarded = await guard(callId, "One moment.");
      emit({ type: "line", callId, who: "agent", text: guarded.speak });
      yield { type: "line", text: guarded.speak };
    },
    async endCall(callId) {
      const call = await store.getCall(callId);
      if (call) await store.saveCall({ ...call, state: "ended", endedAt: await store.now() });
    },
  };
}

/** Everything wired together over one fake store. */
export function createFakes(emit: EmitFn = () => {}) {
  const store = createFakeStore();
  const press = createFakePress(store, emit);
  const guardSentence = createFakeGuard(store, emit);
  const driver = createFakeDriver(store, guardSentence, emit);
  return { store, press, guardSentence, checkCallerLine: fakeCheckCallerLine, driver };
}
