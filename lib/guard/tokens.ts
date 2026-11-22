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

export type Token = { kind: "name" | "rx_number" | "drug" | "address" | "phone" | "dob"; text: string; patientId: string };

function dobForms(dob: string): string[] {
  const [y, m, d] = dob.split("-");
  const month = MONTHS[Number(m) - 1];
  const day = String(Number(d));
  const mon = String(Number(m));
  // Zero-padded and not ("1990 03 14", "3 14 1990"), and the month as a word.
  const forms = [`${y} ${m} ${d}`, `${d} ${m} ${y}`, `${m} ${d} ${y}`, `${y} ${mon} ${day}`, `${day} ${mon} ${y}`, `${mon} ${day} ${y}`];
  return [...new Set([...forms, `${month} ${day} ${y}`, `${day} ${month} ${y}`, `${month} ${day}`, `${day} ${month}`])];
}

export function tokensFor(patient: Patient, prescriptions: Prescription[]): Token[] {
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
  for (const rx of prescriptions) {
    out.push(t("rx_number", rx.rxNumber), t("drug", rx.drug));
    // "Adderall XR" is "Adderall" too.
    const base = rx.drug.match(/^(.{4,}?)\s+(?:XR|ER|SR|CR|XL|LA|CD|DR|ODT)$/i)?.[1];
    if (base) out.push(t("drug", base));
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
  const w = words(token.text).trim();
  if (w.length < 2) return false;
  return words(text).includes(` ${w} `);
}
