// The 12 buttons (SPEC Part 3, "The twelve buttons"). The AI acts only through these.
// Button inputs and outputs use snake_case because they are the JSON the model sees
// as tool schemas. Everything else in the contract is camelCase.

import type {
  AddressId,
  CallId,
  FlagId,
  IsoTime,
  Lane,
  LookupId,
  NoteId,
  OrderId,
  RuleId,
  RxId,
  SlotId,
} from "./ids";

export const BUTTON_NAMES = [
  "lookup_patient",
  "send_code",
  "check_code",
  "check_prescription",
  "read_label",
  "check_coverage",
  "order_status",
  "request_refill",
  "request_renewal",
  "set_delivery",
  "note_for_pharmacist",
  "escalate",
] as const;

export type ButtonName = (typeof BUTTON_NAMES)[number];

/** Risk tier per button (SPEC Part 2, "Risk tiers"). */
export const BUTTON_TIERS: Record<ButtonName, 0 | 1 | 2> = {
  lookup_patient: 0,
  send_code: 0,
  check_code: 0,
  check_prescription: 1,
  read_label: 1,
  check_coverage: 1,
  order_status: 1,
  request_refill: 2,
  request_renewal: 2,
  set_delivery: 2,
  note_for_pharmacist: 2,
  escalate: 0,
};

/** Buttons 4 to 11 need a verified call. */
export const NEEDS_VERIFIED: readonly ButtonName[] = [
  "check_prescription",
  "read_label",
  "check_coverage",
  "order_status",
  "request_refill",
  "request_renewal",
  "set_delivery",
  "note_for_pharmacist",
];

export type RefillState = "queued" | "waiting_for_pharmacist" | "refused" | "approved" | "denied";

export type ButtonInputs = {
  lookup_patient: { name: string; dob: string; rx_number: string };
  send_code: { lookup_id: LookupId };
  check_code: { lookup_id: LookupId; code: string };
  check_prescription: { rx_id: RxId; include_other_names: boolean };
  read_label: { rx_id: RxId };
  check_coverage: { rx_id: RxId };
  order_status: Record<string, never>;
  request_refill: { rx_id: RxId; reason?: string };
  request_renewal: { rx_id: RxId };
  set_delivery: { order_id: OrderId; slot_id: SlotId; address_id: AddressId | "pickup" };
  note_for_pharmacist: { rx_id?: RxId; text: string; kind: "side_effect" | "question" };
  escalate: { reason: string };
};

export type ButtonOutputs = {
  /** Same output whether or not it matched. The match is in the record only. */
  lookup_patient: { lookup_id: LookupId; message: "code sent if matched" };
  send_code: { message: "code sent if matched" };
  check_code:
    | { verified: true; patient_first_name: string }
    | { verified: false; tries_left: number }
    | { locked_until: IsoTime };
  check_prescription: {
    rx_id: RxId;
    drug: string;
    status: "active" | "expired";
    refills_left: number;
    expiry: IsoTime;
    last_fill: IsoTime;
    refillable_today: boolean;
    others_refillable_count: number;
    /** Only present when include_other_names was true. */
    other_names?: string[];
  };
  read_label: { label_text: string };
  check_coverage: { plan_pays: string; patient_pays: string };
  order_status: {
    orders: { order_id: OrderId; rx_id: RxId; status: RefillState; slot_id?: SlotId; slot_label?: string }[];
  };
  request_refill: { state: RefillState; rule_ids: RuleId[]; message: string; order_id?: OrderId };
  request_renewal: { state: "requested" | "waiting_for_pharmacist" | "refused"; rule_ids: RuleId[] };
  set_delivery: { ok: boolean; rule_ids: RuleId[] };
  note_for_pharmacist: { note_id: NoteId };
  escalate: { flag_id: FlagId };
};

/** Errors a button can return. Never thrown to the agent. */
export type ButtonError =
  | "not_verified"
  | "invalid_input"
  | "not_found"
  | "not_yours"
  | "refused"
  | "rate_limited"
  | "locked_out"
  | "call_ended";

export type ButtonResult<B extends ButtonName = ButtonName> =
  | { ok: true; output: ButtonOutputs[B]; ruleIds: RuleId[]; lane?: Lane }
  | { ok: false; error: ButtonError; ruleIds: RuleId[] };

/**
 * The only way the AI acts. Never throws. Every press writes a record entry and
 * emits a "press" event. `input` is unknown because it comes from the model:
 * the control layer validates it.
 */
export type PressFn = <B extends ButtonName>(callId: CallId, button: B, input: unknown) => Promise<ButtonResult<B>>;
