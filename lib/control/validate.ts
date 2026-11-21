// Input checks for the 12 buttons. Input comes from the model, so it is untrusted:
// exact keys only (unknown keys are refused, so no button can take address text),
// right types, bounded lengths.

import type { ButtonInputs, ButtonName } from "@/lib/contract";

export const MAX_ID = 100;
export const MAX_SHORT = 200;
export const MAX_TEXT = 1000;

type FieldSpec = { type: "string"; max: number; optional?: boolean; oneOf?: readonly string[] } | { type: "boolean" };

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
  check_coverage: { rx_id: { type: "string", max: MAX_ID } },
  order_status: {},
  request_refill: { rx_id: { type: "string", max: MAX_ID }, reason: { type: "string", max: MAX_TEXT, optional: true } },
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
};

export type Checked<B extends ButtonName> = { ok: true; input: ButtonInputs[B] } | { ok: false; problem: string };

export function checkInput<B extends ButtonName>(button: B, input: unknown): Checked<B> {
  const spec = SPECS[button];
  if (!spec) return { ok: false, problem: "unknown button" };
  if (input === undefined && Object.keys(spec).length === 0) return { ok: true, input: {} as ButtonInputs[B] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, problem: "input must be an object" };
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in spec)) return { ok: false, problem: `unknown field ${key}` };
  }
  for (const [key, field] of Object.entries(spec)) {
    const value = obj[key];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") return { ok: false, problem: `${key} must be true or false` };
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
