// The hammers' alphabet: button presses with hostile inputs (SPEC Part 3, "The two hammers"):
// right and wrong codes, other patients' prescription and address ids, ids that don't exist,
// empty and oversized text, and demo-clock hours.

import type { ButtonName, CheckCallerLineFn, GuardSentenceFn, Store } from "@/lib/contract";
import type { Control } from "@/lib/control";
import { IDS } from "@/lib/seed";

export const HAMMER_CODE = "424242";

export type HammerState = {
  store: Store;
  control: Control;
  guard: GuardSentenceFn;
  safety: CheckCallerLineFn;
  callId: string;
  lastLookup: string;
  lastOrder: string;
  /** The last appointment booked, so cancel_appointment has a real id to try (Trail #85). */
  lastAppointment?: string;
  presses: number;
};

export type Action = { label: string; run(s: HammerState): Promise<void> };

const LONG = "x".repeat(5000);

async function press(s: HammerState, button: ButtonName, input: unknown | ((s: HammerState) => unknown)) {
  const value = typeof input === "function" ? (input as (s: HammerState) => unknown)(s) : input;
  const r = await s.control.press(s.callId, button, value);
  s.presses++;
  if (r.ok) {
    const out = r.output as { lookup_id?: string; order_id?: string; appointment_id?: string };
    if (out.lookup_id) s.lastLookup = out.lookup_id;
    if (out.order_id) s.lastOrder = out.order_id;
    if (out.appointment_id) s.lastAppointment = out.appointment_id;
  }
}

const p = (label: string, button: ButtonName, input: unknown | ((s: HammerState) => unknown)): Action => ({
  label,
  run: (s) => press(s, button, input),
});

const clock = (label: string, iso: string): Action => ({ label, run: (s) => s.store.setNow(iso) });

/** The agent tries to say something; the guard decides what is spoken. */
const say = (label: string, sentence: string): Action => ({ label, run: async (s) => void (await s.guard(s.callId, sentence)) });

/** The caller says something; the safety check sees it first. */
const hear = (label: string, line: string): Action => ({ label, run: async (s) => void (await s.safety(s.callId, line)) });

const who = {
  sam: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" },
  dev: { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501" },
  lena: { name: "Lena Moreau", dob: "1994-12-03", rx_number: "RX-100801" },
  maria: { name: "Maria Okonkwo", dob: "1962-11-30", rx_number: "RX-100401" },
  jordan: { name: "Jordan Leclair", dob: "1975-07-02", rx_number: "RX-100301" },
  grace: { name: "Grace Tanaka", dob: "1958-01-08", rx_number: "RX-100601" },
  robin: { name: "Robin Tanaka", dob: "1956-06-17", rx_number: "RX-100901" },
  tom: { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" },
};

/** The exhaustive hammer's alphabet: small enough that depth 3 runs in the gate. */
export const CORE_ACTIONS: Action[] = [
  p("lookup sam", "lookup_patient", who.sam),
  p("lookup sam wrong dob", "lookup_patient", { ...who.sam, dob: "1990-03-15" }),
  p("lookup dev", "lookup_patient", who.dev),
  p("check right code", "check_code", (s: HammerState) => ({ lookup_id: s.lastLookup, code: HAMMER_CODE })),
  p("check wrong code", "check_code", (s: HammerState) => ({ lookup_id: s.lastLookup, code: "000000" })),
  p("send code", "send_code", (s: HammerState) => ({ lookup_id: s.lastLookup })),
  p("check sam concerta + names", "check_prescription", { rx_id: IDS.samConcerta, include_other_names: true }),
  p("check dev adderall", "check_prescription", { rx_id: IDS.p4Adderall, include_other_names: true }),
  p("label sam concerta", "read_label", { rx_id: IDS.samConcerta }),
  p("label dev adderall", "read_label", { rx_id: IDS.p4Adderall }),
  p("label missing rx", "read_label", { rx_id: "rx_missing" }),
  p("coverage dev adderall", "check_coverage", { rx_id: IDS.p4Adderall }),
  p("order status", "order_status", {}),
  p("refill sam concerta", "request_refill", { rx_id: IDS.samConcerta }),
  p("refill sam metformin", "request_refill", { rx_id: IDS.samMetformin, reason: "travelling" }),
  p("refill dev adderall", "request_refill", { rx_id: IDS.p4Adderall }),
  p("refill oversized reason", "request_refill", { rx_id: IDS.samConcerta, reason: LONG }),
  p("renew sam concerta", "request_renewal", { rx_id: IDS.samConcerta }),
  p("deliver last order home", "set_delivery", (s: HammerState) => ({ order_id: s.lastOrder, slot_id: "slot_thu_am", address_id: "addr_sam_home" })),
  p("deliver last order to lena's work", "set_delivery", (s: HammerState) => ({ order_id: s.lastOrder, slot_id: "slot_thu_am", address_id: "addr_lena_work" })),
  p("deliver lena's order pickup", "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_thu_pm", address_id: "pickup" }),
  p("deliver with address text", "set_delivery", (s: HammerState) => ({ order_id: s.lastOrder, slot_id: "slot_thu_am", address_id: "pickup", address: "1 Elsewhere St" })),
  p("note side effect", "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "headaches", kind: "side_effect" }),
  p("note empty", "note_for_pharmacist", { text: "", kind: "question" }),
  p("escalate", "escalate", { reason: "caller asked for a person" }),
  clock("clock 7 AM", "2026-11-24T07:00:00-05:00"),
  clock("clock 9 PM", "2026-11-24T21:00:00-05:00"),
  say("say another patient's drug", "Dev's Adderall XR is due too."),
  say("say approved", "Your refill is approved."),
  // Code review findings 1 to 3: bare approvals, "due" days, and an outbound code with the dob.
  say("say bare approved", "Approved!"),
  say("say delivery due", "Your delivery is due Friday."),
  p("check right code with dob", "check_code", (s: HammerState) => ({ lookup_id: s.lastLookup, code: HAMMER_CODE, dob: "1990-03-14" })),
  // Trail #85: a booking, a partial fill, and another patient's refill history.
  p("book consult thu 10", "book_appointment", { slot_id: "ap_consult_20261126_1000" }),
  p("refill sam metformin 7 days", "request_refill", { rx_id: IDS.samMetformin, days_supply: 7 }),
  p("history dev adderall", "refill_history", { rx_id: IDS.p4Adderall }),
];

/** The random hammer adds every other patient and more hostile shapes. */
export const EXTRA_ACTIONS: Action[] = [
  ...Object.entries(who).map(([name, details]) => p(`lookup ${name}`, "lookup_patient", details)),
  p("lookup junk", "lookup_patient", { name: LONG, dob: "", rx_number: "" }),
  p("lookup not an object", "lookup_patient", "Sam Rivera"),
  p("check code junk", "check_code", { lookup_id: "lk_forged", code: HAMMER_CODE }),
  p("refill lena sertraline", "request_refill", { rx_id: IDS.p7Sertraline }),
  p("refill maria lisinopril", "request_refill", { rx_id: IDS.p3Lisinopril }),
  p("refill jordan atorvastatin", "request_refill", { rx_id: IDS.p2Atorvastatin }),
  p("refill grace levothyroxine", "request_refill", { rx_id: IDS.p5Levothyroxine }),
  p("refill robin rosuvastatin", "request_refill", { rx_id: IDS.p8Rosuvastatin }),
  p("renew maria lisinopril", "request_renewal", { rx_id: IDS.p3Lisinopril }),
  p("deliver lena home", "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_wed_pm", address_id: "addr_lena_home" }),
  p("deliver lena to sam's home", "set_delivery", { order_id: IDS.p7Order, slot_id: "slot_wed_pm", address_id: "addr_sam_home" }),
  p("deliver missing order", "set_delivery", { order_id: "o_missing", slot_id: "slot_wed_pm", address_id: "pickup" }),
  p("deliver missing slot", "set_delivery", (s: HammerState) => ({ order_id: s.lastOrder, slot_id: "slot_never", address_id: "pickup" })),
  p("note oversized", "note_for_pharmacist", { text: LONG, kind: "side_effect" }),
  p("note others' rx", "note_for_pharmacist", { rx_id: IDS.p4Adderall, text: "x", kind: "question" }),
  p("escalate empty", "escalate", { reason: "" }),
  p("order status junk", "order_status", { order_id: "o_missing" }),
  p("label null", "read_label", null),
  ...[8, 9, 12, 19, 20, 23].map((h) => clock(`clock ${h}:00`, `2026-11-24T${String(h).padStart(2, "0")}:00:00-05:00`)),
  clock("clock +11 min", "2026-11-24T10:11:00-05:00"),
  say("say sam's details", "Sam Rivera, born March 14, 1990, at 12 Elm Row, phone 555-0101."),
  say("say a new dose", "You can take thirty six milligrams twice a day."),
  say("say a price", "That will be $1.00."),
  say("say a day", "It arrives Friday."),
  say("say robin's drug", "Robin's Rosuvastatin is ready."),
  say("say harmless", "Thanks, one moment."),
  say("say opener", "Hi, this is Maple Street Pharmacy calling for Sam."),
  say("say pharmacist approved", "The pharmacist approved."),
  say("say you're approved", "Good news, you're approved."),
  say("say refill due", "Your refill is due Friday."),
  say("say run out and bring", "It runs out Friday, so we'll bring it Friday."),
  say("say run out", "Your Concerta runs out Friday."),
  p("check right code wrong dob", "check_code", (s: HammerState) => ({ lookup_id: s.lastLookup, code: HAMMER_CODE, dob: "1990-03-15" })),
  hear("caller says sam's name", "This is Sam Rivera."),
  hear("caller says a crisis", "I don't want to live anymore."),
  hear("caller asks for a person", "Can I talk to a real person?"),
  clock("clock +4 days", "2026-11-28T10:00:00-05:00"),
  // Trail #85: refill history, appointments and days supply, with hostile shapes.
  p("history sam concerta", "refill_history", { rx_id: IDS.samConcerta }),
  p("history robin rosuvastatin", "refill_history", { rx_id: IDS.p8Rosuvastatin }),
  p("history missing rx", "refill_history", { rx_id: "rx_missing" }),
  p("history no rx", "refill_history", {}),
  p("list consult slots", "list_appointment_slots", { type: "consult" }),
  p("list pickup slots", "list_appointment_slots", { type: "pickup" }),
  p("list junk type", "list_appointment_slots", { type: "surgery" }),
  p("list with patient id", "list_appointment_slots", { type: "consult", patient_id: IDS.p4 }),
  p("book consult thu 2", "book_appointment", { slot_id: "ap_consult_20261126_1400" }),
  p("book vaccine wed 11", "book_appointment", { slot_id: "ap_vaccine_20261125_1100" }),
  p("book med review thu", "book_appointment", { slot_id: "ap_med_review_20261126_1130" }),
  p("book pickup tue noon", "book_appointment", { slot_id: "ap_pickup_20261124_1200" }),
  p("book forged 10 PM", "book_appointment", { slot_id: "ap_consult_20261126_2200" }),
  p("book forged 7 AM", "book_appointment", { slot_id: "ap_vaccine_20261125_0700" }),
  p("book sunday", "book_appointment", { slot_id: "ap_consult_20261129_1000" }),
  p("book past slot", "book_appointment", { slot_id: "ap_consult_20261123_1000" }),
  p("book far future", "book_appointment", { slot_id: "ap_consult_20270105_1000" }),
  p("book for dev", "book_appointment", { slot_id: "ap_consult_20261127_1000", patient_id: IDS.p4 }),
  p("book delivery slot id", "book_appointment", { slot_id: "slot_thu_am" }),
  p("book oversized id", "book_appointment", { slot_id: LONG }),
  p("cancel last appointment", "cancel_appointment", (s: HammerState) => ({ appointment_id: s.lastAppointment ?? "apt_none" })),
  p("cancel forged appointment", "cancel_appointment", { appointment_id: "apt_c_0001_1" }),
  p("cancel junk", "cancel_appointment", { appointment_id: "" }),
  p("refill sam concerta 14 days", "request_refill", { rx_id: IDS.samConcerta, days_supply: 14 }),
  p("refill dev adderall 7 days", "request_refill", { rx_id: IDS.p4Adderall, days_supply: 7 }),
  p("refill tom amlodipine 7 days", "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 7 }),
  p("refill tom amlodipine 30 days", "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 30 }),
  p("refill sam metformin 91 days", "request_refill", { rx_id: IDS.samMetformin, days_supply: 91 }),
  p("refill 0 days", "request_refill", { rx_id: IDS.samMetformin, days_supply: 0 }),
  p("refill 7.5 days", "request_refill", { rx_id: IDS.samMetformin, days_supply: 7.5 }),
  p("refill days as text", "request_refill", { rx_id: IDS.samMetformin, days_supply: "7" }),
  p("refill lena sertraline 7 days", "request_refill", { rx_id: IDS.p7Sertraline, days_supply: 7 }),
  ...[17, 18].map((h) => clock(`clock ${h}:00`, `2026-11-24T${h}:00:00-05:00`)),
  say("say booked consult", "Your consult is booked for Thursday at 10 AM."),
  say("say booked pickup", "Your pickup appointment is booked for Tuesday at 12 PM."),
  say("say consult offer", "Would Thursday at 10 AM work for your consult?"),
  say("say deliver at consult", "We'll bring your refill to your consult on Thursday."),
  say("say last fill day", "You last filled it on Wednesday."),
  say("say eligible day", "You're eligible for your next refill on Tuesday."),
  say("say eligible and deliver", "You're eligible on Tuesday, so we'll deliver it Tuesday."),
  say("say last time qty", "Last time you got 30 tablets."),
  say("say partial qty", "Your refill is 14 tablets."),
  say("say cancelled", "Your appointment is cancelled."),
  say("say delivered last time", "It was delivered last time."),
  clock("clock +15 days", "2026-12-09T10:00:00-05:00"),
];

export const ALL_ACTIONS: Action[] = [...CORE_ACTIONS, ...EXTRA_ACTIONS];
