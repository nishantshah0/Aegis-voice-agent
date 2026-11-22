import type { ButtonInputs, ButtonName, ButtonOutputs } from "@/lib/contract";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import { createControl } from "@/lib/control";
import { createSpeechGuard, createSafetyCheck } from "@/lib/guard";
import { IDS } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifiedCall(rxId: string) {
  const store = createMemoryStore();
  const code = "613082";
  const control = createControl({ store, makeCode: () => code });
  const guard = createSpeechGuard({ store });
  const safety = createSafetyCheck({ store });
  const callId = await control.startInboundCall();
  async function press<B extends ButtonName>(button: B, input: ButtonInputs[B]): Promise<ButtonOutputs[B]> {
    const result = await control.press(callId, button, input);
    if (!result.ok) throw new Error(`${button} returned ${result.error}.`);
    return result.output;
  }
  async function speak(text: string) {
    const line = await guard(callId, text);
    if (line.blocked) throw new Error(`The recorded readback was blocked by ${line.rule}.`);
    check(line.speak === text, "The spoken readback differed from the record.");
  }
  const rx = await store.getPrescription(rxId);
  check(rx, "The seeded prescription was unavailable.");
  const patient = await store.getPatient(rx.patientId);
  check(patient, "The seeded patient was unavailable.");
  const lookup = await press("lookup_patient", { name: patient.firstName + " " + patient.lastName, dob: patient.dob, rx_number: rx.rxNumber });
  const identity = await press("check_code", { lookup_id: lookup.lookup_id, code });
  check("verified" in identity && identity.verified, "The synthetic caller could not verify their identity.");
  return { store, rx, patient, control, callId, press, speak, caller: (text: string) => safety(callId, text) };
}

const cases: { label: string; run: () => Promise<string> }[] = [
  {
    label: "Ordinary refill",
    async run() {
      const { store, press, rx } = await verifiedCall(IDS.p8Rosuvastatin);
      const refill = await press("request_refill", { rx_id: rx.id });
      const orders = await store.listOrders(rx.patientId);
      check(refill.state === "queued" && orders.some(o => o.id === refill.order_id && o.rxId === rx.id && o.state === "queued"),
        `Expected the verified patient's due refill to enter the queue. Received ${refill.state}.`);
      return `${rx.drug} entered the queue for the verified patient.`;
    },
  },
  {
    label: "Last fill and dispensed quantity",
    async run() {
      const { rx, press, speak } = await verifiedCall(IDS.samMetformin);
      const history = await press("check_prescription", { rx_id: rx.id, include_other_names: false });
      check(history.last_fill === rx.lastFill && history.last_quantity === 180 && history.last_quantity_unit === "tablets" && history.days_supplied === 90,
        "The reported last fill did not match the seeded 180 tablets for 90 days.");
      await speak(history.history_readback);
      return history.history_readback;
    },
  },
  {
    label: "Seven-day insured refill",
    async run() {
      const { rx, press, speak, store } = await verifiedCall(IDS.p6Amlodipine);
      const quote = await press("check_coverage", { rx_id: rx.id, days_supply: 7 });
      check(quote.available && quote.days_supply === 7 && quote.patient_pays === "$1.25" && quote.plan_pays === "$3.25", "Seven-day plan and patient shares did not match the recorded quote.");
      await speak(quote.coverage_readback);
      const refill = await press("request_refill", { rx_id: rx.id, days_supply: 7 });
      check(refill.days_supply === 7 && (await store.listOrders(rx.patientId)).some(o => o.id === refill.order_id && o.daysSupply === 7), "The refill did not retain the requested seven-day supply.");
      return `${quote.coverage_readback} The order retained the seven-day supply.`;
    },
  },
  {
    label: "Missing insurance estimate",
    async run() {
      const { rx, press, speak } = await verifiedCall(IDS.p6Amlodipine);
      const quote = await press("check_coverage", { rx_id: rx.id, days_supply: 14 });
      check(!quote.available && quote.days_supply === 14 && quote.plan_pays === null && quote.patient_pays === null, "The missing 14-day estimate returned a price.");
      await speak(quote.coverage_readback);
      return quote.coverage_readback;
    },
  },
  {
    label: "Corrected appointment time",
    async run() {
      const { store, patient, control, callId, press, caller, speak } = await verifiedCall(IDS.p6Amlodipine);
      const availability = await press("order_status", { include_appointments: true });
      const wed = availability.appointment_slots?.find(s => s.slot_id === "consult_wed_10");
      const thu = availability.appointment_slots?.find(s => s.slot_id === "consult_thu_14");
      check(wed && thu, "The two seeded consultation slots were unavailable.");
      await speak(wed.availability_text);
      await speak(APPOINTMENT_CONFIRMATION_QUESTION);
      await caller("Actually, Thursday at two works better.");
      const unconfirmed = await control.press(callId, "note_for_pharmacist", { kind: "appointment", slot_id: wed.slot_id });
      check(!unconfirmed.ok && unconfirmed.error === "refused", "The original appointment could be booked after the caller corrected the time.");
      await speak(thu.availability_text);
      await speak(APPOINTMENT_CONFIRMATION_QUESTION);
      await caller("Yes, please.");
      const booked = await press("note_for_pharmacist", { kind: "appointment", slot_id: thu.slot_id });
      check("slot_id" in booked && booked.slot_id === thu.slot_id, "The appointment confirmation did not name the corrected slot.");
      await speak(booked.confirmation_text);
      const mine = (await store.listAppointments()).filter(a => a.patientId === patient.id);
      check(mine.length === 1 && mine[0].slotId === thu.slot_id, "The original or duplicate appointment was retained.");
      return booked.confirmation_text;
    },
  },
  {
    label: "Side effect sent to review",
    async run() {
      const { store, rx, press, caller } = await verifiedCall(IDS.samConcerta);
      const refill = await press("request_refill", { rx_id: rx.id });
      check(refill.state === "waiting_for_pharmacist", "The controlled refill missed pharmacist review.");
      const text = "I have had mild headaches in the afternoon.";
      await caller(text);
      await press("note_for_pharmacist", { rx_id: rx.id, kind: "side_effect", text });
      const item = (await store.queue()).find(q => q.kind === "refill" && q.orderId === refill.order_id && q.rxId === rx.id);
      check(item?.lane === "review" && item.signals.includes("side_effect") && item.notes.some(n => n.text === text), "The open refill did not carry the patient's side-effect note to Review.");
      return "The pharmacist’s review item contains the caller’s own words and names the affected prescription.";
    },
  },
  {
    label: "Two prescriptions, two prices",
    async run() {
      const { press, speak } = await verifiedCall(IDS.samConcerta);
      const concerta = await press("check_coverage", { rx_id: IDS.samConcerta });
      await speak(concerta.coverage_readback);
      const metformin = await press("check_coverage", { rx_id: IDS.samMetformin });
      await speak(metformin.coverage_readback);
      check(concerta.rx_id !== metformin.rx_id && concerta.drug === "Concerta" && metformin.drug === "Metformin"
        && concerta.patient_pays === "$4.10" && metformin.patient_pays === "$2.00", "The two patient shares were not matched to their respective prescriptions.");
      return `Recorded patient shares: ${concerta.drug} ${concerta.patient_pays} and ${metformin.drug} ${metformin.patient_pays}.`;
    },
  },
];

export async function runBusinessChecks() {
  const checks = await Promise.all(cases.map(async ({ label, run }) => {
    try { return { label, passed: true, detail: await run() }; }
    catch (error) { return { label, passed: false, detail: error instanceof Error ? error.message : "The workflow did not complete." }; }
  }));
  return { checks, passed: checks.filter(c => c.passed).length, total: checks.length };
}
