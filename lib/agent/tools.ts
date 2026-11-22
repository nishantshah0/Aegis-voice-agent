// The 12 buttons as Claude tools (SPEC Part 3, "The twelve buttons").
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

const daysSupply = { type: "integer", description: "Positive whole days of medication for this fill, as requested by the caller" };

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
      "Check one verified prescription, including its recorded last fill date, dispensed quantity and days supplied. Use history_readback for a history question.",
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
    description: "Read the stored plan and patient price for this prescription and supply. Use coverage_readback.",
    input_schema: schema({ rx_id: text("The prescription id"), days_supply: daysSupply }, ["days_supply"]),
  },
  order_status: {
    description: "Get the verified patient's orders. Set include_appointments to list available pharmacist consultations and this patient's bookings.",
    input_schema: schema({ include_appointments: { type: "boolean", description: "Include pharmacist consultation slots and bookings" } }, ["include_appointments"]),
  },
  request_refill: {
    description:
      "Ask for a refill. Returns the refill's state and the rule numbers that decided it. A pharmacist may need to check it first.",
    input_schema: schema(
      { rx_id: text("The prescription id"), reason: text("Why now, in the caller's words, if they gave one"), days_supply: daysSupply },
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
    description: "Leave a side-effect or question note. For a consultation, select the available slot the caller chose with kind appointment and slot_id.",
    input_schema: schema(
      {
        rx_id: text("The prescription it is about, if any"),
        text: text("The note, in the caller's own words where you can"),
        slot_id: text("Available consultation slot id, for appointments only"),
        kind: { type: "string", enum: ["side_effect", "question", "appointment"], description: "What the caller needs" },
      },
      ["rx_id", "slot_id"],
    ),
  },
  escalate: {
    description: "Hand the call to a pharmacist now. Use it whenever someone asks for a person.",
    input_schema: schema({ reason: text("Why, in a few words") }),
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
