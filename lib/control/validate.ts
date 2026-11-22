// Input checks for the buttons. Input comes from the model, so it is untrusted:
// exact keys only (unknown keys are refused, so no button can take address text),
// right types, bounded lengths.

import { APPOINTMENT_TYPES, type ButtonInputs, type ButtonName } from "@/lib/contract";
import { MAX_DAYS_SUPPLY } from "./supply";

export const MAX_ID = 100;
export const MAX_SHORT = 200;
export const MAX_TEXT = 1000;

type FieldSpec =
  | { type: "string"; max: number; optional?: boolean; oneOf?: readonly string[] }
  | { type: "boolean"; optional?: boolean }
  /** A whole number from min to max. */
  | { type: "integer"; min: number; max: number; optional?: boolean }
  | { type: "positive_integer"; optional?: boolean };

const SPECS: Record<ButtonName, Record<string, FieldSpec>> = {
  lookup_patient: {
    name: { type: "string", max: MAX_SHORT },
    dob: { type: "string", max: 40 },
    rx_number: { type: "string", max: 40 },
  },
  send_code: { lookup_id: { type: "string", max: MAX_ID } },
  check_code: { lookup_id: { type: "string", max: MAX_ID }, code: { type: "string", max: 20 }, dob: { type: "string", max: 40, optional: true } },
  check_prescription: { rx_id: { type: "string", max: MAX_ID }, include_other_names: { type: "boolean" } },
  read_label: { rx_id: { type: "string", max: MAX_ID } },
  check_coverage: { rx_id: { type: "string", max: MAX_ID }, days_supply: { type: "positive_integer", optional: true } },
  order_status: { include_appointments: { type: "boolean", optional: true } },
  request_refill: {
    rx_id: { type: "string", max: MAX_ID },
    reason: { type: "string", max: MAX_TEXT, optional: true },
    days_supply: { type: "integer", min: 1, max: MAX_DAYS_SUPPLY, optional: true },
  },
  request_renewal: { rx_id: { type: "string", max: MAX_ID } },
  set_delivery: {
    order_id: { type: "string", max: MAX_ID },
    slot_id: { type: "string", max: MAX_ID },
    address_id: { type: "string", max: MAX_ID },
  },
  note_for_pharmacist: {
    rx_id: { type: "string", max: MAX_ID, optional: true },
    text: { type: "string", max: MAX_TEXT },
    kind: { type: "string", max: 20, oneOf: ["side_effect", "question"] },
  },
  escalate: { reason: { type: "string", max: MAX_TEXT } },
  refill_history: { rx_id: { type: "string", max: MAX_ID } },
  list_appointment_slots: { type: { type: "string", max: 20, oneOf: APPOINTMENT_TYPES } },
  book_appointment: { slot_id: { type: "string", max: MAX_ID } },
  cancel_appointment: { appointment_id: { type: "string", max: MAX_ID } },
};

export type Checked<B extends ButtonName> = { ok: true; input: ButtonInputs[B] } | { ok: false; problem: string };

export function checkInput<B extends ButtonName>(button: B, input: unknown): Checked<B> {
  let spec = SPECS[button];
  if (button === "note_for_pharmacist" && (input as { kind?: unknown } | null)?.kind === "appointment") {
    spec = {
      kind: { type: "string", max: 20, oneOf: ["appointment"] },
      slot_id: { type: "string", max: MAX_ID },
      text: { type: "string", max: MAX_TEXT, optional: true },
    };
  }
  if (!spec) return { ok: false, problem: "unknown button" };
  if (input === undefined && button === "order_status") return { ok: true, input: {} as ButtonInputs[B] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, problem: "input must be an object" };
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(spec, key)) return { ok: false, problem: `unknown field ${key}` };
  }
  for (const [key, field] of Object.entries(spec)) {
    const value = obj[key];
    if (value === undefined && field.optional) continue;
    if (field.type === "positive_integer") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return { ok: false, problem: `${key} must be a positive whole number` };
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") return { ok: false, problem: `${key} must be true or false` };
      continue;
    }
    if (field.type === "integer") {
      if (value === undefined && field.optional) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < field.min || value > field.max) {
        return { ok: false, problem: `${key} must be a whole number from ${field.min} to ${field.max}` };
      }
      continue;
    }
    if (value === undefined && field.optional) continue;
    if (typeof value !== "string") return { ok: false, problem: `${key} must be text` };
    if (value.trim().length === 0 && !field.optional) return { ok: false, problem: `${key} is empty` };
    if (value.length > field.max) return { ok: false, problem: `${key} is too long` };
    if (field.oneOf && !field.oneOf.includes(value)) return { ok: false, problem: `${key} must be one of ${field.oneOf.join(", ")}` };
  }
  return { ok: true, input: obj as ButtonInputs[B] };
}

/** Lowercase, collapse spaces and strip punctuation, for matching names and numbers. */
export const normalise = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Rx numbers compare without spaces, dashes or case: "rx 100201" = "RX-100201". */
export const normaliseRxNumber = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Dates of birth as YYYY-MM-DD from "1990-03-14", "1990/03/14" or "14/03/1990"; undefined if unclear. */
export function normaliseDob(text: string): string | undefined {
  const t = text.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}
