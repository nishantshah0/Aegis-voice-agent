// The buttons as Claude tools (SPEC Part 3, "The twelve buttons").
//
// Strict schemas, so every tool_use input the model sends matches its button's
// input shape. The control layer still checks every input itself: the schema
// helps the model press correctly, it does not decide anything.
//
// Descriptions say what a button does and returns, never what it refuses.
// What a press is allowed to do is decided in lib/control.

import type Anthropic from "@anthropic-ai/sdk";
import { BUTTON_NAMES, type ButtonName } from "@/lib/contract";

type Schema = Anthropic.Beta.BetaTool["input_schema"];

const text = (description: string) => ({ type: "string", description });

function schema(properties: Record<string, object>, optional: string[] = []): Schema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((k) => !optional.includes(k)),
    additionalProperties: false,
  };
}

const BUTTONS: Record<ButtonName, { description: string; input_schema: Schema }> = {
  lookup_patient: {
    description:
      "Look up the caller from their full name, date of birth and prescription number. If they match, a code is texted to the phone on file. The reply is the same either way.",
    input_schema: schema({
      name: text("Full name as the caller said it"),
      dob: text("Date of birth, for example 1990-03-14"),
      rx_number: text("Prescription number from the label, for example RX-100201"),
    }),
  },
  send_code: {
    description: "Send (or resend) the verification code to the phone on file for this lookup.",
    input_schema: schema({ lookup_id: text("The lookup id") }),
  },
  check_code: {
    description:
      "Check the code the caller read back. On success the call is verified for that patient, and the reply lists their prescriptions with each rx_id.",
    input_schema: schema(
      {
        lookup_id: text("The lookup id"),
        code: text("The code exactly as the caller said it"),
        dob: text("The date of birth the caller gave, as YYYY-MM-DD, for example 1990-03-14. Required on outbound calls."),
      },
      ["dob"],
    ),
  },
  check_prescription: {
    description:
      "Status of one of the verified patient's prescriptions: refills left, expiry, last fill, whether it can be refilled today, and how many others are ready.",
    input_schema: schema({
      rx_id: text("The prescription id"),
      include_other_names: { type: "boolean", description: "Also return the names of the other prescriptions ready to refill" },
    }),
  },
  read_label: {
    description: "The prescription's label text, exactly as printed. Quote it when you say how a medicine is taken.",
    input_schema: schema({ rx_id: text("The prescription id") }),
  },
  check_coverage: {
    description: "What the plan pays and what the patient pays for this prescription.",
    input_schema: schema({ rx_id: text("The prescription id") }),
  },
  order_status: {
    description: "The verified patient's open orders, with their status and delivery slot.",
    input_schema: schema({}),
  },
  request_refill: {
    description:
      "Ask for a refill. Returns the refill's state and the rule numbers that decided it. A pharmacist may need to check it first.",
    input_schema: schema(
      {
        rx_id: text("The prescription id"),
        reason: text("Why now, in the caller's words, if they gave one"),
        days_supply: { type: "integer", description: "Only if the caller asks for fewer days than prescribed, e.g. 7 or 14" },
      },
      ["reason", "days_supply"],
    ),
  },
  request_renewal: {
    description: "Ask the prescriber to renew a prescription that has run out of refills or expired.",
    input_schema: schema({ rx_id: text("The prescription id") }),
  },
  set_delivery: {
    description: "Book delivery or pickup for an order, using a slot and an address on file, or pickup.",
    input_schema: schema({
      order_id: text("The order id"),
      slot_id: text("The delivery slot id"),
      address_id: text('An address id on file, or "pickup"'),
    }),
  },
  note_for_pharmacist: {
    description: "Leave the pharmacist a note: a side effect the caller mentioned, or a question you cannot answer.",
    input_schema: schema(
      {
        rx_id: text("The prescription it is about, if any"),
        text: text("The note, in the caller's own words where you can"),
        kind: { type: "string", enum: ["side_effect", "question"], description: "side_effect or question" },
      },
      ["rx_id"],
    ),
  },
  escalate: {
    description: "Hand the call to a pharmacist now. Use it whenever someone asks for a person.",
    input_schema: schema({ reason: text("Why, in a few words") }),
  },
  // Trail #85 (Role 4's minimal rows; Role 1 owns the wording).
  refill_history: {
    description:
      "The verified patient's last fill of a prescription: date, quantity, days supply, pickup or delivery, refills left, the next date it can be refilled, and the prescriber.",
    input_schema: schema({ rx_id: text("The prescription id") }),
  },
  list_appointment_slots: {
    description: "Open appointment times in the next 14 days for one type, and the caller's own bookings.",
    input_schema: schema({
      type: { type: "string", enum: ["consult", "vaccine", "med_review", "pickup"], description: "consult, vaccine, med_review or pickup" },
    }),
  },
  book_appointment: {
    description: "Book one open slot from list_appointment_slots for the verified caller.",
    input_schema: schema({ slot_id: text("The slot id") }),
  },
  cancel_appointment: {
    description: "Cancel one of the verified caller's own appointments.",
    input_schema: schema({ appointment_id: text("The appointment id") }),
  },
};

/** The 12 buttons as strict tools, in BUTTON_NAMES order (stable, so the prompt prefix caches). */
export const BUTTON_TOOLS: Anthropic.Beta.BetaTool[] = BUTTON_NAMES.map((name) => ({
  name,
  description: BUTTONS[name].description,
  input_schema: BUTTONS[name].input_schema,
  strict: true,
}));

export const isButtonName = (name: string): name is ButtonName => (BUTTON_NAMES as readonly string[]).includes(name);
