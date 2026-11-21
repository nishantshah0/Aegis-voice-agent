// Rule cards (SPEC Part 3, "Rule cards"). Data, not code. There is no "allow"
// outcome, so no card can loosen anything.

import type { ButtonName } from "./buttons";
import type { IsoTime, RuleId } from "./ids";

export const CARD_FIELDS = [
  "drug.class",
  "drug.controlled",
  "rx.pct_days_elapsed",
  "rx.days_late",
  "rx.refills_left",
  "rx.expired",
  "rx.days_since_last_fill",
  "rx.prescribed_interval_days",
  "call.direction",
  "call.caller_type",
  "call.local_hour",
  "patient.flags",
  "patient.opted_in",
  "request.reason_given",
  "recent.blocked_count_10min",
  "recent.renewals_7d",
  "recent.outbound_calls_3d",
  "policy.controlled_early_window_days",
] as const;

export type CardField = (typeof CARD_FIELDS)[number];

export type CardOp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "contains";

export type CardValue = string | number | boolean | (string | number)[];

/**
 * One condition. `value` may instead name another field plus an offset, so card 4b can say
 * days_since_last_fill < prescribed_interval_days - controlled_early_window_days.
 */
export type CardCondition = {
  field: CardField;
  op: CardOp;
  value: CardValue | { field: CardField; minus?: CardField | number };
};

export type CardOutcome = "refuse" | "route" | "flag";

export type RuleCard = {
  id: RuleId;
  wording: string;
  /** All conditions must hold. */
  when: CardCondition[];
  then: CardOutcome;
  /** Optional text shown to the pharmacist, e.g. "possible missed doses". */
  flagText?: string;
  appliesTo: (ButtonName | "outbound_check")[];
  risk: string;
  author: string;
  approvedBy: string;
  approvedAt: IsoTime;
  tests: string[];
  live: boolean;
};

/** Every field a card may read, filled in by the control layer and saved in the record. */
export type RuleContext = Partial<Record<CardField, CardValue>>;
