// Shared id and small value types. Ids are plain strings so they survive JSON.

export type CallId = string;
export type PatientId = string;
export type RxId = string;
export type AddressId = string;
export type OrderId = string;
export type SlotId = string;
export type LookupId = string;
export type QueueItemId = string;
export type NoteId = string;
export type FlagId = string;
export type AppointmentSlotId = string;
export type AppointmentId = string;

/** ISO 8601 timestamp, for example "2026-11-24T10:00:00-05:00". */
export type IsoTime = string;

/** Rule ids as strings: core rules "1" and "5", cards "2a", "2b", "3", "4", "4b", "6", "7", "8", "11", "12", "13a" to "13e". */
export type RuleId = string;

export type SpeechRule = "S1" | "S2" | "S3" | "S4";

/** Triage lane, chosen in code (lib/control), never by the AI. */
export type Lane = "automatic" | "quick_check" | "review";

export type Direction = "inbound" | "outbound";

/** The person behind a decision. Taken from the Auth0 token, never from a request body. */
export type Approver = {
  id: string;
  name: string;
  role: "pharmacist" | "reviewer";
};
