// A simulated patient population for the Outreach viewer and lib/sim. Every person here is
// made up and generated from a fixed seed, so the same seed gives the same people every run.
// This is a separate dataset: SEED (Sam Rivera and the other demo patients) is untouched, and
// nothing here is ever loaded into the live store.
//
// Phone numbers stay inside 555-01xx, which only has 100 numbers, so in a population larger
// than that some patients share a number (like a household line).

import type { Patient, Prescription } from "@/lib/contract";
import { DEMO_NOW, PHARMACY_NAME } from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AdherencePattern = "steady" | "often_late" | "chronic_skipper" | "recently_lapsed" | "new_patient";
export const ADHERENCE_PATTERNS: readonly AdherencePattern[] = ["steady", "often_late", "chronic_skipper", "recently_lapsed", "new_patient"];

export type FillStatus = "on_time" | "late" | "skipped" | "stopped";

/** One refill that was due. `filledAt` is missing when it was skipped or the patient stopped. */
export type FillEvent = { dueAt: string; filledAt?: string; status: FillStatus; daysLate: number };

export type CallOutcome = "answered" | "voicemail" | "no_answer" | "asked_for_pharmacist";
export const CALL_OUTCOMES: readonly CallOutcome[] = ["answered", "voicemail", "no_answer", "asked_for_pharmacist"];

export type PastCall = { at: string; rxId: string; outcome: CallOutcome };

export type PreferredCallTime = "morning" | "afternoon" | "evening";
/** The pharmacy-time hour the sim calls at for each preference. All inside rule 7's 9 AM to 8 PM. */
export const CALL_HOUR: Record<PreferredCallTime, number> = { morning: 10, afternoon: 14, evening: 18 };

/** A medication the patient used to take and stopped. Shown in the history only. */
export type StoppedMed = { drug: string; strength: string; stoppedAt: string; history: FillEvent[] };

export type SimPatient = {
  patient: Patient;
  prescriptions: Prescription[];
  pattern: AdherencePattern;
  preferredCallTime: PreferredCallTime;
  /** Refill history for each active prescription, oldest first, about 12 months. */
  history: Record<string, FillEvent[]>;
  stopped: StoppedMed[];
  /** Past outbound calls, oldest first. */
  pastCalls: PastCall[];
  sideEffects: { at: string; rxId: string; text: string }[];
};

export type Population = {
  /** Always true: the viewer shows this on every screen. */
  simulated: true;
  seed: number;
  size: number;
  /** The clock the population is drawn against (the demo clock by default). */
  asOf: string;
  pharmacyName: string;
  patients: SimPatient[];
};

// ---------- Deterministic randomness ----------

/** mulberry32: a small seeded generator. Same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string, to derive per-patient seeds. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Rand = () => number;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: Rand, p: number) => r() < p;

// ---------- Made-up names and drugs ----------

const FIRST = [
  "Avery", "Blake", "Carmen", "Dana", "Eli", "Farah", "Gabe", "Hana", "Ines", "Jules", "Kai", "Lior", "Mina", "Noor", "Owen", "Priya",
  "Quinn", "Rosa", "Silas", "Tess", "Uma", "Vic", "Wren", "Xavi", "Yara", "Zane", "Ada", "Bram", "Cleo", "Dorian", "Edie", "Finn",
  "Greta", "Hugo", "Iris", "Joel", "Kira", "Luca", "Maeve", "Nico", "Olive", "Pavel", "Rhea", "Soren", "Tilda", "Ugo", "Vera", "Wade",
  "Yusuf", "Zoe", "Anouk", "Bodhi", "Celine", "Dmitri", "Esme", "Felix", "Gwen", "Hamid", "Ivy", "Jonah",
] as const;

const LAST = [
  "Abernathy", "Bellweather", "Castellano", "Delacroix", "Eastbrook", "Fairholme", "Galloway", "Hartigan", "Ivers", "Jessop",
  "Kowalczyk", "Lindqvist", "Marchetti", "Nakashima", "Oyelaran", "Pemberton", "Quaid", "Rasmussen", "Szabo", "Thorvald",
  "Underhill", "Vasquez-Lowe", "Whitcombe", "Yilmaz", "Zielinski", "Ashdown", "Brennick", "Corvino", "Dunmore", "Elsworth",
  "Fennimore", "Grisham-Tate", "Holloway", "Ingersoll", "Jaramillo", "Kettering", "Larkspur", "Mendelsohn", "Nordahl", "Osei",
  "Pritchard", "Ravensworth", "Strand", "Tolliver", "Ulrich", "Vantongeren", "Wexley", "Yoshida", "Zamora", "Achterberg",
] as const;

const STREETS = ["Elm", "Birch", "Cedar", "Maple", "Oak", "Willow", "Spruce", "Ash", "Poplar", "Linden", "Hawthorn", "Juniper"] as const;

type DrugInfo = { drug: string; drugClass: string; strength: string; controlled: boolean; supplies: number[]; sig: string; unit: string; effects: string[] };

const DRUGS: readonly DrugInfo[] = [
  { drug: "Atorvastatin", drugClass: "statin", strength: "20 mg", controlled: false, supplies: [30, 90], sig: "once a day at bedtime", unit: "TABLET", effects: ["muscle aches in the legs", "mild stomach upset"] },
  { drug: "Rosuvastatin", drugClass: "statin", strength: "10 mg", controlled: false, supplies: [30, 90], sig: "once a day", unit: "TABLET", effects: ["muscle aches", "headaches in the first week"] },
  { drug: "Metformin", drugClass: "biguanide", strength: "500 mg", controlled: false, supplies: [30, 90], sig: "twice a day with meals", unit: "TABLET", effects: ["upset stomach after meals", "loose stools"] },
  { drug: "Lisinopril", drugClass: "ACE inhibitor", strength: "10 mg", controlled: false, supplies: [30, 90], sig: "once a day", unit: "TABLET", effects: ["a dry cough", "dizziness when standing up"] },
  { drug: "Amlodipine", drugClass: "calcium channel blocker", strength: "5 mg", controlled: false, supplies: [30, 90], sig: "once a day", unit: "TABLET", effects: ["swollen ankles", "flushing"] },
  { drug: "Losartan", drugClass: "ARB", strength: "50 mg", controlled: false, supplies: [30, 90], sig: "once a day", unit: "TABLET", effects: ["dizziness", "tiredness"] },
  { drug: "Levothyroxine", drugClass: "thyroid hormone", strength: "50 mcg", controlled: false, supplies: [30, 90], sig: "every morning before breakfast", unit: "TABLET", effects: ["trouble sleeping", "a racing heart"] },
  { drug: "Sertraline", drugClass: "SSRI", strength: "50 mg", controlled: false, supplies: [30], sig: "once a day", unit: "TABLET", effects: ["nausea", "trouble sleeping"] },
  { drug: "Escitalopram", drugClass: "SSRI", strength: "10 mg", controlled: false, supplies: [30], sig: "once a day", unit: "TABLET", effects: ["feeling tired", "headaches"] },
  { drug: "Omeprazole", drugClass: "proton pump inhibitor", strength: "20 mg", controlled: false, supplies: [30, 90], sig: "once a day before breakfast", unit: "CAPSULE", effects: ["headaches"] },
  { drug: "Methylphenidate ER", drugClass: "stimulant", strength: "36 mg", controlled: true, supplies: [30], sig: "every morning", unit: "TABLET", effects: ["poor appetite", "trouble sleeping"] },
  { drug: "Adderall XR", drugClass: "stimulant", strength: "20 mg", controlled: true, supplies: [30], sig: "every morning", unit: "CAPSULE", effects: ["dry mouth", "poor appetite"] },
  { drug: "Lorazepam", drugClass: "benzodiazepine", strength: "1 mg", controlled: true, supplies: [30], sig: "at bedtime as needed", unit: "TABLET", effects: ["feeling drowsy in the morning"] },
  { drug: "Clonazepam", drugClass: "benzodiazepine", strength: "0.5 mg", controlled: true, supplies: [30], sig: "twice a day", unit: "TABLET", effects: ["feeling unsteady"] },
];

/** How often each pattern turns up, out of 100. */
const PATTERN_WEIGHTS: [AdherencePattern, number][] = [
  ["steady", 42],
  ["often_late", 22],
  ["chronic_skipper", 14],
  ["recently_lapsed", 10],
  ["new_patient", 12],
];

/** How each pattern behaves: lateness, skips, and how likely they pick up. */
const BEHAVIOUR: Record<AdherencePattern, { late: number; lateDays: [number, number]; skip: number; answer: number; pharmacist: number }> = {
  steady: { late: 0.06, lateDays: [3, 5], skip: 0.01, answer: 0.78, pharmacist: 0.04 },
  often_late: { late: 0.6, lateDays: [3, 12], skip: 0.05, answer: 0.55, pharmacist: 0.05 },
  chronic_skipper: { late: 0.35, lateDays: [5, 20], skip: 0.35, answer: 0.35, pharmacist: 0.06 },
  recently_lapsed: { late: 0.1, lateDays: [3, 7], skip: 0.03, answer: 0.6, pharmacist: 0.08 },
  new_patient: { late: 0.15, lateDays: [3, 6], skip: 0.05, answer: 0.65, pharmacist: 0.1 },
};

// ---------- Generation ----------

const at = (base: number, days: number) => new Date(base + days * DAY_MS).toISOString();

function weightedPattern(r: Rand): AdherencePattern {
  let roll = r() * 100;
  for (const [p, w] of PATTERN_WEIGHTS) {
    if ((roll -= w) < 0) return p;
  }
  return "steady";
}

/**
 * Walks back from the last fill to about 12 months before `asOf`, drawing each earlier fill
 * from the pattern. Returns the history oldest first.
 */
function drawHistory(r: Rand, pattern: AdherencePattern, lastFill: number, supply: number, startMs: number, asOfMs: number): FillEvent[] {
  const b = BEHAVIOUR[pattern];
  const events: FillEvent[] = [];
  // The due date after the last fill. If it has passed, it is a missed refill (lapsed patients).
  const nextDue = lastFill + supply * DAY_MS;
  const missedDays = Math.floor((asOfMs - nextDue) / DAY_MS);
  if (missedDays > 3) events.push({ dueAt: new Date(nextDue).toISOString(), status: pattern === "recently_lapsed" ? "stopped" : "skipped", daysLate: missedDays });

  let fill = lastFill;
  while (fill > startMs) {
    if (chance(r, b.skip)) {
      // Skipped one cycle: the patient went without for a whole supply, then came back.
      const delay = int(r, 0, 4);
      const due = fill - delay * DAY_MS;
      events.push({ dueAt: new Date(due).toISOString(), filledAt: new Date(fill).toISOString(), status: delay > 2 ? "late" : "on_time", daysLate: delay });
      const skippedDue = due - supply * DAY_MS;
      if (skippedDue > startMs) events.push({ dueAt: new Date(skippedDue).toISOString(), status: "skipped", daysLate: supply });
      fill = skippedDue - supply * DAY_MS;
      continue;
    }
    const late = chance(r, b.late);
    const delay = late ? int(r, b.lateDays[0], b.lateDays[1]) : int(r, -3, 2);
    const due = fill - delay * DAY_MS;
    events.push({ dueAt: new Date(due).toISOString(), filledAt: new Date(fill).toISOString(), status: delay > 2 ? "late" : "on_time", daysLate: Math.max(0, delay) });
    fill = due - supply * DAY_MS;
  }
  events.sort((a, b2) => Date.parse(a.dueAt) - Date.parse(b2.dueAt));
  // The oldest fill in the window has no earlier fill to be late against.
  const first = events[0];
  if (first?.filledAt) events[0] = { dueAt: first.filledAt, filledAt: first.filledAt, status: "on_time", daysLate: 0 };
  return events;
}

/** Days of supply left at `asOf`, by pattern. Lapsed patients have already run out. */
function drawDaysLeft(r: Rand, pattern: AdherencePattern, supply: number): number {
  if (pattern === "recently_lapsed") return -int(r, 4, 24);
  if (pattern === "chronic_skipper" && chance(r, 0.3)) return -int(r, 1, 15);
  if (pattern === "new_patient") return int(r, Math.max(1, supply - 28), supply);
  return int(r, -2, supply);
}

function drawPastCalls(r: Rand, pattern: AdherencePattern, prefersHour: number, history: Record<string, FillEvent[]>, asOfMs: number): PastCall[] {
  const b = BEHAVIOUR[pattern];
  const calls: PastCall[] = [];
  for (const [rxId, events] of Object.entries(history)) {
    for (const e of events) {
      // The daily check rings three days before each due date.
      const day = Date.parse(e.dueAt) - 3 * DAY_MS;
      if (day >= asOfMs) continue;
      const callAt = new Date(day - (10 - prefersHour) * 60 * 60 * 1000).toISOString();
      let outcome: CallOutcome;
      if (chance(r, b.answer)) outcome = chance(r, b.pharmacist) ? "asked_for_pharmacist" : "answered";
      else outcome = chance(r, 0.6) ? "voicemail" : "no_answer";
      calls.push({ at: callAt, rxId, outcome });
    }
  }
  return calls.sort((a, b2) => Date.parse(a.at) - Date.parse(b2.at));
}

function makePrescription(r: Rand, patientId: string, idx: number, n: number, d: DrugInfo, supply: number, lastFillMs: number, asOfMs: number): Prescription {
  const refillsTotal = d.controlled ? int(r, 1, 3) : int(r, 2, 6);
  // About 6% have used every refill, and about 4% expire inside or before the sim window.
  const refillsLeft = chance(r, 0.06) ? 0 : int(r, 1, refillsTotal);
  const expiresIn = chance(r, 0.04) ? int(r, -10, 25) : int(r, 60, 330);
  const qty = d.sig.includes("twice") ? supply * 2 : supply;
  return {
    id: `sim_rx_${String(n).padStart(4, "0")}_${String.fromCharCode(97 + idx)}`,
    patientId,
    rxNumber: `SIM-${String(200000 + n * 10 + idx)}`,
    drug: d.drug,
    drugClass: d.drugClass,
    strength: d.strength,
    controlled: d.controlled,
    daysSupplied: supply,
    prescribedIntervalDays: supply,
    lastFill: new Date(lastFillMs).toISOString(),
    refillsLeft,
    refillsTotal,
    expiry: at(asOfMs, expiresIn),
    labelText: `${d.drug.toUpperCase()} ${d.strength.toUpperCase()} ${d.unit}. Take 1 by mouth ${d.sig}. Qty ${qty}.`,
    lastDispensedQuantity: { count: qty, unit: d.unit === "CAPSULE" ? "capsules" : "tablets" },
    // Seeded training prices. These are fictional plan quotes, independent of retail prices.
    planPays: `$${(10 + (n + idx * 3) % 31).toFixed(2)}`,
    patientPays: `$${((n + idx) % 5 * 1.25).toFixed(2)}`,
    supplyQuotes: [{ days: 7, planPays: `$${(5 + n % 9).toFixed(2)}`, patientPays: `$${(n % 3 * 0.75).toFixed(2)}` }],
  };
}

function makePatient(n: number, seed: number, asOf: string): SimPatient {
  const r = rng(hashSeed(`${seed}:${n}`));
  const asOfMs = Date.parse(asOf);
  const startMs = asOfMs - 365 * DAY_MS;
  const id = `sim_p_${String(n).padStart(4, "0")}`;
  const pattern = weightedPattern(r);
  const preferredCallTime = pick(r, ["morning", "morning", "afternoon", "evening"] as const);
  const firstName = pick(r, FIRST);
  const lastName = pick(r, LAST);
  const year = int(r, 1938, 2004);
  const patient: Patient = {
    id,
    firstName,
    lastName,
    dob: `${year}-${String(int(r, 1, 12)).padStart(2, "0")}-${String(int(r, 1, 28)).padStart(2, "0")}`,
    phone: `555-01${String(n % 100).padStart(2, "0")}`,
    addresses: [{ id: `sim_addr_${n}`, label: "Home", line1: `${int(r, 2, 480)} ${pick(r, STREETS)} Street`, city: "London", postal: "N6A 0A0" }],
    optedInToCalls: chance(r, 0.92),
    flags: [],
    householdPatientIds: [],
  };

  const count = pattern === "new_patient" ? 1 : chance(r, 0.35) ? 2 : 1;
  const drugs = new Set<DrugInfo>();
  // About 1 in 6 patients is on a controlled drug.
  if (chance(r, 0.17)) drugs.add(pick(r, DRUGS.filter((d) => d.controlled)));
  while (drugs.size < count) drugs.add(pick(r, DRUGS.filter((d) => !d.controlled)));

  const prescriptions: Prescription[] = [];
  const history: Record<string, FillEvent[]> = {};
  [...drugs].forEach((d, idx) => {
    const supply = pick(r, d.supplies);
    const left = drawDaysLeft(r, pattern, supply);
    const lastFillMs = asOfMs - (supply - left) * DAY_MS;
    const rx = makePrescription(r, id, idx, n, d, supply, lastFillMs, asOfMs);
    prescriptions.push(rx);
    const firstFill = pattern === "new_patient" ? lastFillMs - int(r, 0, 1) * supply * DAY_MS : startMs;
    history[rx.id] = drawHistory(r, pattern, lastFillMs, supply, Math.max(startMs, firstFill - 1), asOfMs);
  });

  const stopped: StoppedMed[] = [];
  if ((pattern === "chronic_skipper" || pattern === "recently_lapsed") && chance(r, 0.3)) {
    const d = pick(r, DRUGS.filter((x) => !x.controlled && ![...drugs].includes(x)));
    const stoppedAt = asOfMs - int(r, 60, 240) * DAY_MS;
    const fills: FillEvent[] = [];
    for (let t = stoppedAt - 30 * DAY_MS * int(r, 2, 4); t < stoppedAt; t += 30 * DAY_MS) fills.push({ dueAt: new Date(t).toISOString(), filledAt: new Date(t + int(r, 0, 6) * DAY_MS).toISOString(), status: "on_time", daysLate: 0 });
    fills.push({ dueAt: new Date(stoppedAt).toISOString(), status: "stopped", daysLate: 0 });
    stopped.push({ drug: d.drug, strength: d.strength, stoppedAt: new Date(stoppedAt).toISOString(), history: fills.map((f) => (f.filledAt && Date.parse(f.filledAt) - Date.parse(f.dueAt) > 2 * DAY_MS ? { ...f, status: "late", daysLate: Math.round((Date.parse(f.filledAt) - Date.parse(f.dueAt)) / DAY_MS) } : f)) });
  }

  const pastCalls = patient.optedInToCalls ? drawPastCalls(r, pattern, CALL_HOUR[preferredCallTime], history, asOfMs) : [];
  const sideEffects: SimPatient["sideEffects"] = [];
  if (chance(r, 0.15)) {
    const rx = pick(r, prescriptions);
    const d = DRUGS.find((x) => x.drug === rx.drug)!;
    sideEffects.push({ at: at(asOfMs, -int(r, 10, 300)), rxId: rx.id, text: pick(r, d.effects) });
  }

  return { patient, prescriptions, pattern, preferredCallTime, history, stopped, pastCalls, sideEffects };
}

export const POPULATION_SEED = 20261124;
export const POPULATION_SIZE = 240;

/** The simulated population. Same seed, size and clock give the same people, byte for byte. */
export function generatePopulation({ seed = POPULATION_SEED, size = POPULATION_SIZE, asOf = DEMO_NOW }: { seed?: number; size?: number; asOf?: string } = {}): Population {
  if (!Number.isInteger(size) || size < 1 || size > 2000) throw new Error(`population size must be 1 to 2000, got ${size}`);
  const patients = Array.from({ length: size }, (_, i) => makePatient(i + 1, seed, asOf));
  return { simulated: true, seed, size, asOf, pharmacyName: PHARMACY_NAME, patients };
}
