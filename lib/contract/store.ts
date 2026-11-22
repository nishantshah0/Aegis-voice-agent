// Store (DESIGN 3.5) and the data it holds. Every method is async so the in-memory
// store (Role 4) and the Postgres store (Role 2) are a one-line swap.

import type { ButtonName, RefillState } from "./buttons";
import type {
  AddressId,
  Approver,
  CallId,
  Direction,
  IsoTime,
  Lane,
  NoteId,
  OrderId,
  PatientId,
  QueueItemId,
  RuleId,
  RxId,
  SlotId,
} from "./ids";
import type { RuleCard, RuleContext } from "./rules";

// ---------- Seed data shapes (SPEC Part 5, "Made-up data to seed") ----------

export type Address = { id: AddressId; label: string; line1: string; city: string; postal: string };

export type Patient = {
  id: PatientId;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dob: string;
  /** Made-up numbers only: 555-01xx. */
  phone: string;
  addresses: Address[];
  optedInToCalls: boolean;
  flags: string[];
  /** Others who share this phone, e.g. P8's spouse. Never spoken before verification. */
  householdPatientIds: PatientId[];
};

export type Prescription = {
  id: RxId;
  patientId: PatientId;
  /** The number printed on the bottle, what callers read out. */
  rxNumber: string;
  drug: string;
  drugClass: string;
  strength: string;
  controlled: boolean;
  daysSupplied: number;
  /** The interval the prescriber wrote between fills, in days. */
  prescribedIntervalDays: number;
  lastFill: IsoTime;
  refillsLeft: number;
  /** Which fill this would be, e.g. Sam is on refill 1 of 2. */
  refillsTotal: number;
  expiry: IsoTime;
  /** Exactly as printed. read_label returns this unchanged. */
  labelText: string;
  planPays: string;
  patientPays: string;
};

export type DeliverySlot = { id: SlotId; label: string; start: IsoTime; end: IsoTime };

export type Order = {
  id: OrderId;
  rxId: RxId;
  patientId: PatientId;
  state: RefillState;
  slotId?: SlotId;
  addressId?: AddressId | "pickup";
  createdAt: IsoTime;
};

export type Seed = {
  /** The demo clock at reset: Tuesday 10 AM. */
  now: IsoTime;
  pharmacyName: string;
  patients: Patient[];
  prescriptions: Prescription[];
  slots: DeliverySlot[];
  orders: Order[];
  cards: RuleCard[];
  policy: { controlledEarlyWindowDays: number };
};

// ---------- Calls ----------

export type CallState = "greeting" | "collecting" | "code_sent" | "verified" | "locked_out" | "ended";

export type Call = {
  id: CallId;
  direction: Direction;
  state: CallState;
  /** Set once verified. The call is locked to this patient for good. */
  lockedPatientId?: PatientId;
  /** For outbound calls, who we rang. */
  targetPatientId?: PatientId;
  startedAt: IsoTime;
  endedAt?: IsoTime;
  failedCodeTries: number;
  lockedUntil?: IsoTime;
  /** Words the caller has said in this call (S1 and S2 let these be repeated back). */
  callerSaid: string[];
};

// ---------- The decision record (SPEC Part 3, "The decision record") ----------

export type RecordActor = "agent" | "caller" | "system" | "pharmacist" | "reviewer";

export type RecordKind =
  | "button"
  | "line_spoken"
  | "line_blocked"
  | "caller_line"
  | "safety"
  | "approval"
  | "rule_change"
  | "gate_run";

export type RecordDecision = "allowed" | "blocked" | "routed" | "flagged";

export type RecordEntryInput = {
  callId?: CallId;
  actor: RecordActor;
  kind: RecordKind;
  button?: ButtonName;
  input?: unknown;
  output?: unknown;
  /** Every field the rule cards read, so any card can be replayed later. */
  context?: RuleContext;
  ruleIds?: RuleId[];
  decision?: RecordDecision;
  lane?: Lane;
};

export type RecordEntry = RecordEntryInput & {
  id: string;
  /** Position in the whole record, from 1. */
  seq: number;
  at: IsoTime;
  prevHash: string;
  /** sha256(prevHash + canonical JSON of this entry without hash). */
  hash: string;
};

// ---------- Pharmacist queue ----------

export type Signal =
  | "early"
  | "new_address"
  | "side_effect"
  | "missed_doses"
  | "failed_code_attempts"
  | "speech_guard_replacement"
  | "safety_words"
  | "attack_alarm";

export type QueueItem = {
  id: QueueItemId;
  callId: CallId;
  patientId: PatientId;
  rxId?: RxId;
  orderId?: OrderId;
  kind: "refill" | "renewal" | "delivery" | "note" | "escalation";
  lane: Lane;
  /** The rules that sent it here. */
  ruleIds: RuleId[];
  signals: Signal[];
  /** Side-effect or question text from note_for_pharmacist. */
  notes: { id: NoteId; kind: "side_effect" | "question"; text: string }[];
  /** The AI's own view, shown labelled, never used for decisions. */
  aiView?: string;
  status: "open" | "approved" | "denied";
  decidedBy?: Approver;
  decidedAt?: IsoTime;
  decisionNote?: string;
  createdAt: IsoTime;
};

// ---------- The store ----------

export interface Store {
  now(): Promise<IsoTime>;
  setNow(now: IsoTime): Promise<void>;

  getPatient(id: PatientId): Promise<Patient | undefined>;
  listPatients(): Promise<Patient[]>;
  getPrescriptions(patientId: PatientId): Promise<Prescription[]>;
  getPrescription(rxId: RxId): Promise<Prescription | undefined>;
  listSlots(): Promise<DeliverySlot[]>;
  listOrders(patientId?: PatientId): Promise<Order[]>;
  saveOrder(order: Order): Promise<Order>;
  listCards(): Promise<RuleCard[]>;
  /**
   * Add one rule card after the others. Only lib/control's applyApprovedCard calls this, after
   * a signed-in pharmacist approves a checked draft (AUDIT #9). Throws if the id is taken.
   * Reset drops it with the rest of the store.
   */
  addCard(card: RuleCard): Promise<RuleCard>;
  policy(): Promise<Seed["policy"]>;

  getCall(id: CallId): Promise<Call | undefined>;
  saveCall(call: Call): Promise<Call>;

  /** Adds id, seq, at and the hash chain. */
  appendRecord(entry: RecordEntryInput): Promise<RecordEntry>;
  listRecord(callId?: CallId): Promise<RecordEntry[]>;

  addQueueItem(item: Omit<QueueItem, "id" | "createdAt" | "status">): Promise<QueueItem>;
  queue(lane?: Lane): Promise<QueueItem[]>;
  /** Change an open item's lane, signals or notes (e.g. a side effect moves a refill to Review). Throws if it isn't open. */
  updateQueueItem(itemId: QueueItemId, patch: Partial<Pick<QueueItem, "lane" | "signals" | "notes">>): Promise<QueueItem>;
  /** Writes an "approval" record entry. The approver comes from the token. */
  decide(itemId: QueueItemId, decision: "approve" | "deny", approver: Approver, note?: string): Promise<QueueItem>;

  /** Clears calls, orders made since seed, queue and record, then loads the seed. */
  reset(seed: Seed): Promise<void>;
  /**
   * Run fn so its writes all stay or none do: if fn throws, every write it made is undone and the
   * error is rethrown (AUDIT fix 4b). Optional until the Postgres store has one; the control
   * layer runs each press and its record entry inside it when present.
   */
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}
