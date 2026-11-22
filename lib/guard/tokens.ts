// The token index S1 and S2 check against (SPEC Part 3, "Speech rules"): names,
// prescription numbers, drug names, addresses, phone digits and dates of birth,
// in the formats people say and write them.

import type { Patient, Prescription } from "@/lib/contract";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Lowercase words and digits only, single spaces, padded so " word " matches whole words. */
export function words(text: string): string {
  const t = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’']/g, "")
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ` ${t} `;
}

/** Every digit in the text, in order. */
export const digitsOf = (text: string): string => text.replace(/\D/g, "");

// "drug_class" (a drug's class, "ADHD medication") counts before verification only: after it,
// asking "are you on any blood pressure medication?" names nobody's record. "age" is the
// patient's age today, said as an age ("you turned 36", "36 years old").
export type Token = {
  kind: "name" | "rx_number" | "drug" | "drug_class" | "address" | "phone" | "dob" | "age";
  text: string;
  patientId: string;
  /** For another name of a drug ("Adderall", "methylphenidate"): the prescription's own drug name. */
  of?: string;
};

// Each seeded drug's other names (generic or brand) and its classes, so "methylphenidate" or
// "your stimulant" is Concerta to S1 (Trail #88, round 3). Keyed by the drug in lowercase.
const DRUG_NAMES: Record<string, { names: string[]; classes: string[] }> = {
  concerta: { names: ["methylphenidate", "ritalin"], classes: ["adhd medication", "adhd medicine", "adhd meds", "stimulant"] },
  "adderall xr": { names: ["amphetamine", "amphetamine salts", "dextroamphetamine", "mixed amphetamine salts"], classes: ["adhd medication", "adhd medicine", "adhd meds", "stimulant"] },
  vyvanse: { names: ["lisdexamfetamine"], classes: ["adhd medication", "adhd medicine", "adhd meds", "stimulant"] },
  metformin: { names: ["glucophage"], classes: ["diabetes medication", "diabetes medicine", "diabetes meds", "blood sugar medication"] },
  atorvastatin: { names: ["lipitor"], classes: ["statin", "cholesterol medication", "cholesterol medicine", "cholesterol pill"] },
  rosuvastatin: { names: ["crestor"], classes: ["statin", "cholesterol medication", "cholesterol medicine", "cholesterol pill"] },
  lisinopril: { names: ["zestril", "prinivil"], classes: ["blood pressure medication", "blood pressure medicine", "blood pressure pill", "ace inhibitor"] },
  amlodipine: { names: ["norvasc"], classes: ["blood pressure medication", "blood pressure medicine", "blood pressure pill"] },
  metoprolol: { names: ["lopressor", "toprol"], classes: ["blood pressure medication", "blood pressure medicine", "blood pressure pill", "beta blocker"] },
  levothyroxine: { names: ["synthroid", "eltroxin"], classes: ["thyroid medication", "thyroid medicine", "thyroid pill"] },
  sertraline: { names: ["zoloft"], classes: ["antidepressant", "ssri", "depression medication", "anxiety medication"] },
  clonazepam: { names: ["klonopin", "rivotril"], classes: ["benzodiazepine", "benzo", "anxiety medication", "seizure medication"] },
};

/** Age in whole years on `at`. */
function ageOn(dob: string, at: Date): number {
  const [y, m, d] = dob.split("-").map(Number);
  const before = at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d);
  return at.getFullYear() - y - (before ? 1 : 0);
}

function dobForms(dob: string): string[] {
  const [y, m, d] = dob.split("-");
  const month = MONTHS[Number(m) - 1];
  const day = String(Number(d));
  const mon = String(Number(m));
  // Zero-padded and not ("1990 03 14", "3 14 1990"), and the month as a word.
  const forms = [`${y} ${m} ${d}`, `${d} ${m} ${y}`, `${m} ${d} ${y}`, `${y} ${mon} ${day}`, `${day} ${mon} ${y}`, `${mon} ${day} ${y}`];
  return [...new Set([...forms, `${month} ${day} ${y}`, `${day} ${month} ${y}`, `${month} ${day}`, `${day} ${month}`])];
}

export function tokensFor(patient: Patient, prescriptions: Prescription[], at: Date = new Date()): Token[] {
  const t = (kind: Token["kind"], text: string): Token => ({ kind, text, patientId: patient.id });
  const out: Token[] = [t("name", patient.firstName), t("name", patient.lastName)];
  for (const a of patient.addresses) {
    out.push(t("address", a.line1), t("address", a.postal), t("address", a.postal.replace(/\s+/g, "")));
    // The street on its own ("Elm Row", "Cedar Court") is part of the address too.
    const street = a.line1.replace(/^\d+\s*/, "");
    if (street !== a.line1 && street.split(/\s+/).length >= 2) out.push(t("address", street));
  }
  out.push(t("phone", patient.phone));
  for (const form of dobForms(patient.dob)) out.push(t("dob", form));
  out.push(t("age", String(ageOn(patient.dob, at))));
  for (const rx of prescriptions) {
    out.push(t("rx_number", rx.rxNumber), t("drug", rx.drug));
    // "Adderall XR" is "Adderall" too.
    const base = rx.drug.match(/^(.{4,}?)\s+(?:XR|ER|SR|CR|XL|LA|CD|DR|ODT)$/i)?.[1];
    const alias = (kind: Token["kind"], text: string): Token => ({ ...t(kind, text), of: rx.drug });
    if (base) out.push(alias("drug", base));
    const other = DRUG_NAMES[rx.drug.toLowerCase()];
    for (const name of other?.names ?? []) out.push(alias("drug", name));
    for (const c of other?.classes ?? []) out.push(alias("drug_class", c));
  }
  return out;
}

/** Whether `token` appears in `text`. Digit tokens match on digits, word tokens on whole words. */
export function mentions(text: string, token: Token): boolean {
  if (token.kind === "phone") {
    const digits = digitsOf(token.text);
    // Look only inside number-like runs, so "555-0101", "555 0101" and "5550101" all match.
    return (text.match(/\d[\d\s().-]*\d/g) ?? []).some((run) => digitsOf(run).includes(digits));
  }
  if (token.kind === "rx_number") {
    const digits = digitsOf(token.text);
    return digits.length > 0 && (text.match(/\d[\d\s-]*\d/g) ?? []).some((run) => digitsOf(run) === digits);
  }
  if (token.kind === "age") return AGE_PHRASES(token.text).test(words(text));
  const w = words(token.text).trim();
  if (w.length < 2) return false;
  const said = words(text);
  if (said.includes(` ${w} `)) return true;
  if (token.kind === "drug") return nearMiss(said, w);
  if (token.kind === "address") return addressFragment(said, w);
  return false;
}

// "you turned 36", "you're 36", "36 years old", "36 this year".
const AGE_PHRASES = (n: string) =>
  new RegExp(`\\b(?:turned|turning|youre|you re|you are|youll be|you will be|age|aged) ${n}\\b|\\b${n} (?:years? old|this year|years of age)\\b`);

// Ordinary words a letter or two from a seeded drug name.
const NOT_A_DRUG = new Set(["concert", "concerts", "concerto", "concerted"]);

/**
 * A near-miss spelling of a one-word drug name ("Conserta", "Aderall"): the same first letter
 * and at most 1 edit for names of 6 or 7 letters, 2 for longer ones.
 */
function nearMiss(said: string, drug: string): boolean {
  if (drug.includes(" ") || drug.length < 6) return false;
  const most = drug.length >= 8 ? 2 : 1;
  return said
    .trim()
    .split(" ")
    .some((w) => w[0] === drug[0] && Math.abs(w.length - drug.length) <= most && !NOT_A_DRUG.has(w) && editDistance(w, drug) <= most);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/**
 * Part of a street address: the house number within two words of the street's first word
 * ("number 12 on Elm" for "12 Elm Row"), or the postal code's first half ("N6A" for "N6A 0A1").
 */
function addressFragment(said: string, address: string): boolean {
  const street = address.match(/^(\d+) ([a-z]+)\b/);
  if (street) {
    const [, n, first] = street;
    return new RegExp(`\\b${n}(?: [a-z]+){0,2} ${first}\\b|\\b${first}(?: [a-z]+){0,2} ${n}\\b`).test(said);
  }
  const postal = address.match(/^([a-z]\d[a-z]) ?\d[a-z]\d$/);
  return postal ? said.includes(` ${postal[1]} `) : false;
}
