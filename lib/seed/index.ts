// Seed data (SPEC Part 5, "Made-up data to seed"). Every person, phone (555-01xx),
// address, date and price here is made up. Dates are relative to the demo clock:
// Tuesday 2026-11-24, 10 AM in London, Ontario (UTC-5).

import { STARTING_CARDS, type Patient, type Prescription, type Seed } from "@/lib/contract";

export const DEMO_NOW = "2026-11-24T10:00:00-05:00";
export const PHARMACY_NAME = "Maple Street Pharmacy";

const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO time `days` before the demo clock, at 10 AM local (UTC-5). */
export function daysBefore(days: number): string {
  return new Date(Date.parse(DEMO_NOW) - days * DAY_MS).toISOString();
}

/** An ISO time `days` after the demo clock. */
export function daysAfter(days: number): string {
  return daysBefore(-days);
}

/** Stable ids. Scenarios and tests use these, never array positions. */
export const IDS = {
  sam: "p_sam",
  samConcerta: "rx_sam_concerta",
  samMetformin: "rx_sam_metformin",
  p2: "p_jordan",
  p2Atorvastatin: "rx_jordan_atorvastatin",
  p3: "p_maria",
  p3Lisinopril: "rx_maria_lisinopril",
  p4: "p_dev",
  p4Adderall: "rx_dev_adderall",
  p5: "p_grace",
  p5Levothyroxine: "rx_grace_levothyroxine",
  p6: "p_tom",
  p6Amlodipine: "rx_tom_amlodipine",
  p7: "p_lena",
  p7Sertraline: "rx_lena_sertraline",
  p7Order: "o_lena_sertraline",
  p8: "p_robin",
  p8Rosuvastatin: "rx_robin_rosuvastatin",
} as const;

type PatientInput = Omit<Patient, "addresses" | "optedInToCalls" | "flags" | "householdPatientIds"> &
  Partial<Pick<Patient, "addresses" | "optedInToCalls" | "flags" | "householdPatientIds">>;

function patient(p: PatientInput): Patient {
  return {
    optedInToCalls: true,
    flags: [],
    householdPatientIds: [],
    addresses: [],
    ...p,
  };
}

type RxInput = Omit<Prescription, "prescribedIntervalDays" | "refillsTotal" | "controlled"> &
  Partial<Pick<Prescription, "prescribedIntervalDays" | "refillsTotal" | "controlled">>;

function rx(r: RxInput): Prescription {
  return {
    controlled: false,
    prescribedIntervalDays: r.daysSupplied,
    refillsTotal: r.refillsLeft,
    ...r,
  };
}

const patients: Patient[] = [
  // Sam: the demo patient. Outbound call, rule 4, approval, side-effect note.
  patient({
    id: IDS.sam,
    firstName: "Sam",
    lastName: "Rivera",
    dob: "1990-03-14",
    phone: "555-0101",
    addresses: [{ id: "addr_sam_home", label: "Home", line1: "12 Elm Row", city: "London", postal: "N6A 0A1" }],
  }),
  // P2: early refill, rule 3.
  patient({
    id: IDS.p2,
    firstName: "Jordan",
    lastName: "Leclair",
    dob: "1975-07-02",
    phone: "555-0102",
    addresses: [{ id: "addr_jordan_home", label: "Home", line1: "48 Birch Lane", city: "London", postal: "N6B 0B2" }],
  }),
  // P3: expired prescription, renewal, rule 2.
  patient({
    id: IDS.p3,
    firstName: "Maria",
    lastName: "Okonkwo",
    dob: "1962-11-30",
    phone: "555-0103",
    addresses: [{ id: "addr_maria_home", label: "Home", line1: "7 Cedar Court", city: "London", postal: "N6C 0C3" }],
  }),
  // P4: controlled drug asked early, rules 4 and 4b.
  patient({
    id: IDS.p4,
    firstName: "Dev",
    lastName: "Halvorsen",
    dob: "2001-05-19",
    phone: "555-0104",
    addresses: [{ id: "addr_dev_home", label: "Home", line1: "301 Pine Street", city: "London", postal: "N6D 0D4" }],
  }),
  // P5: 12 days late, rule 6. Shares a phone with P8.
  patient({
    id: IDS.p5,
    firstName: "Grace",
    lastName: "Tanaka",
    dob: "1958-01-08",
    phone: "555-0105",
    addresses: [{ id: "addr_tanaka_home", label: "Home", line1: "22 Oak Crescent", city: "London", postal: "N6E 0E5" }],
    householdPatientIds: [IDS.p8],
  }),
  // P6: not opted in to calls, rule 7.
  patient({
    id: IDS.p6,
    firstName: "Tom",
    lastName: "Brennan",
    dob: "1983-09-21",
    phone: "555-0106",
    optedInToCalls: false,
    addresses: [{ id: "addr_tom_home", label: "Home", line1: "9 Willow Way", city: "London", postal: "N6F 0F6" }],
  }),
  // P7: two addresses on file, rule 5.
  patient({
    id: IDS.p7,
    firstName: "Lena",
    lastName: "Moreau",
    dob: "1994-12-03",
    phone: "555-0107",
    addresses: [
      { id: "addr_lena_home", label: "Home", line1: "15 Maple Avenue", city: "London", postal: "N6G 0G7" },
      { id: "addr_lena_work", label: "Work", line1: "200 King Street", city: "London", postal: "N6H 0H8" },
    ],
  }),
  // P8: P5's spouse on the same phone, outbound privacy.
  patient({
    id: IDS.p8,
    firstName: "Robin",
    lastName: "Tanaka",
    dob: "1956-06-17",
    phone: "555-0105",
    addresses: [{ id: "addr_tanaka_home", label: "Home", line1: "22 Oak Crescent", city: "London", postal: "N6E 0E5" }],
    householdPatientIds: [IDS.p5],
  }),
];

const prescriptions: Prescription[] = [
  rx({
    id: IDS.samConcerta,
    patientId: IDS.sam,
    rxNumber: "RX-100201",
    drug: "Concerta",
    drugClass: "stimulant",
    strength: "36 mg",
    controlled: true,
    daysSupplied: 30,
    // 27 days ago: runs out Friday, passes rules 3 (90%) and 4b (27 >= 30 - 3) today.
    lastFill: daysBefore(27),
    refillsLeft: 2,
    refillsTotal: 2,
    expiry: daysAfter(155),
    labelText: "CONCERTA 36 MG TABLET. Take 1 tablet by mouth every morning. Qty 30.",
    planPays: "$41.20",
    patientPays: "$4.10",
  }),
  rx({
    id: IDS.samMetformin,
    patientId: IDS.sam,
    rxNumber: "RX-100202",
    drug: "Metformin",
    drugClass: "biguanide",
    strength: "500 mg",
    daysSupplied: 90,
    lastFill: daysBefore(54),
    refillsLeft: 3,
    expiry: daysAfter(281),
    labelText: "METFORMIN 500 MG TABLET. Take 1 tablet by mouth twice a day with meals. Qty 180.",
    planPays: "$12.60",
    patientPays: "$2.00",
  }),
  rx({
    id: IDS.p2Atorvastatin,
    patientId: IDS.p2,
    rxNumber: "RX-100301",
    drug: "Atorvastatin",
    drugClass: "statin",
    strength: "20 mg",
    daysSupplied: 30,
    // 10 of 30 days: 33%, under rule 3's 80%.
    lastFill: daysBefore(10),
    refillsLeft: 4,
    expiry: daysAfter(200),
    labelText: "ATORVASTATIN 20 MG TABLET. Take 1 tablet by mouth once a day at bedtime. Qty 30.",
    planPays: "$18.90",
    patientPays: "$3.00",
  }),
  rx({
    id: IDS.p3Lisinopril,
    patientId: IDS.p3,
    rxNumber: "RX-100401",
    drug: "Lisinopril",
    drugClass: "ACE inhibitor",
    strength: "10 mg",
    daysSupplied: 30,
    lastFill: daysBefore(28),
    refillsLeft: 1,
    // Expired 10 days ago: rule 2a refuses, the agent offers a renewal.
    expiry: daysBefore(10),
    labelText: "LISINOPRIL 10 MG TABLET. Take 1 tablet by mouth once a day. Qty 30.",
    planPays: "$9.80",
    patientPays: "$2.00",
  }),
  rx({
    id: IDS.p4Adderall,
    patientId: IDS.p4,
    rxNumber: "RX-100501",
    drug: "Adderall XR",
    drugClass: "stimulant",
    strength: "20 mg",
    controlled: true,
    daysSupplied: 30,
    // 20 days ago: 20 < 30 - 3, so rule 4b refuses.
    lastFill: daysBefore(20),
    refillsLeft: 2,
    expiry: daysAfter(120),
    labelText: "ADDERALL XR 20 MG CAPSULE. Take 1 capsule by mouth every morning. Qty 30.",
    planPays: "$52.30",
    patientPays: "$6.50",
  }),
  rx({
    id: IDS.p5Levothyroxine,
    patientId: IDS.p5,
    rxNumber: "RX-100601",
    drug: "Levothyroxine",
    drugClass: "thyroid hormone",
    strength: "50 mcg",
    daysSupplied: 30,
    // 42 days ago on a 30-day supply: 12 days late, rule 6 flags missed doses.
    lastFill: daysBefore(42),
    refillsLeft: 5,
    expiry: daysAfter(240),
    labelText: "LEVOTHYROXINE 50 MCG TABLET. Take 1 tablet by mouth every morning before breakfast. Qty 30.",
    planPays: "$8.40",
    patientPays: "$2.00",
  }),
  rx({
    id: IDS.p6Amlodipine,
    patientId: IDS.p6,
    rxNumber: "RX-100701",
    drug: "Amlodipine",
    drugClass: "calcium channel blocker",
    strength: "5 mg",
    daysSupplied: 30,
    lastFill: daysBefore(27),
    refillsLeft: 3,
    expiry: daysAfter(180),
    labelText: "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth once a day. Qty 30.",
    planPays: "$10.20",
    patientPays: "$2.00",
  }),
  rx({
    id: IDS.p7Sertraline,
    patientId: IDS.p7,
    rxNumber: "RX-100801",
    drug: "Sertraline",
    drugClass: "SSRI",
    strength: "50 mg",
    daysSupplied: 30,
    lastFill: daysBefore(26),
    refillsLeft: 2,
    expiry: daysAfter(150),
    labelText: "SERTRALINE 50 MG TABLET. Take 1 tablet by mouth once a day. Qty 30.",
    planPays: "$14.70",
    patientPays: "$2.50",
  }),
  rx({
    id: IDS.p8Rosuvastatin,
    patientId: IDS.p8,
    rxNumber: "RX-100901",
    drug: "Rosuvastatin",
    drugClass: "statin",
    strength: "10 mg",
    daysSupplied: 30,
    lastFill: daysBefore(26),
    refillsLeft: 3,
    expiry: daysAfter(210),
    labelText: "ROSUVASTATIN 10 MG TABLET. Take 1 tablet by mouth once a day. Qty 30.",
    planPays: "$16.10",
    patientPays: "$2.50",
  }),
];

/** The seed. Treat as read-only: the store copies it on reset. */
export const SEED: Seed = {
  now: DEMO_NOW,
  pharmacyName: PHARMACY_NAME,
  patients,
  prescriptions,
  slots: [
    { id: "slot_wed_pm", label: "Wednesday 1 to 5", start: "2026-11-25T13:00:00-05:00", end: "2026-11-25T17:00:00-05:00" },
    { id: "slot_thu_am", label: "Thursday 9 to 12", start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T12:00:00-05:00" },
    { id: "slot_thu_pm", label: "Thursday 1 to 5", start: "2026-11-26T13:00:00-05:00", end: "2026-11-26T17:00:00-05:00" },
  ],
  // P7 has one open order, so set_delivery and rule 5 can be tried without a refill first.
  orders: [
    { id: IDS.p7Order, rxId: IDS.p7Sertraline, patientId: IDS.p7, state: "queued", createdAt: daysBefore(1) },
  ],
  cards: STARTING_CARDS,
  policy: { controlledEarlyWindowDays: 3 },
};
