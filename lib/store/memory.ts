// The in-memory Store (DESIGN 3.5). Role 2's Postgres store implements the same
// interface later. Server-only: the record's hash chain uses node:crypto.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { LegacyAppointment, Call, QueueItem, RecordEntry, Seed, Store } from "@/lib/contract";
import { withSignalRelane } from "@/lib/control/relane";
import { SEED } from "@/lib/seed";

/** JSON with object keys sorted at every level, so the same entry always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const GENESIS_HASH = "0".repeat(64);

/** sha256(prevHash + canonical JSON of the entry without its hash). */
export function hashEntry(entry: Omit<RecordEntry, "hash">): string {
  return createHash("sha256").update(entry.prevHash + canonicalJson(entry)).digest("hex");
}

/** The seq of the first broken entry, or null if the chain is intact. */
export function findBrokenLink(entries: RecordEntry[]): number | null {
  let prev = GENESIS_HASH;
  for (const entry of entries) {
    const { hash, ...rest } = entry;
    if (entry.prevHash !== prev || hashEntry(rest) !== hash) return entry.seq;
    prev = hash;
  }
  return null;
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

type State = {
  data: Seed;
  now: string;
  calls: Map<string, Call>;
  appointments: Map<string, LegacyAppointment>;
  record: RecordEntry[];
  queue: QueueItem[];
  counters: Record<string, number>;
};

function freshState(seed: Seed): State {
  return { data: clone(seed), now: seed.now, calls: new Map(), appointments: new Map(), record: [], queue: [], counters: {} };
}

export function createMemoryStore(seed: Seed = SEED): Store {
  let s = freshState(seed);
  // Every write runs in turn on one queue: a transaction, or a single write made outside one.
  // So no outside write ever lands while a transaction is open, and its rollback undoes only its
  // own writes (Trail #83 review). Writes nested inside a queued task (decide's appendRecord, a
  // press's writes) run straight away. Reads never wait.
  let txQueue: Promise<void> = Promise.resolve();
  const queued = new AsyncLocalStorage<true>();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    if (queued.getStore()) return fn();
    const run = txQueue.then(() => queued.run(true, fn));
    txQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const nextId = (prefix: string) => {
    s.counters[prefix] = (s.counters[prefix] ?? 0) + 1;
    return `${prefix}_${String(s.counters[prefix]).padStart(6, "0")}`;
  };

  const store: Store = {
    async now() {
      return s.now;
    },
    async setNow(now) {
      return serial(async () => {
        if (Number.isNaN(Date.parse(now))) throw new Error(`not a time: ${now}`);
        s.now = now;
      });
    },

    async getPatient(id) {
      return clone(s.data.patients.find((p) => p.id === id));
    },
    async listPatients() {
      return clone(s.data.patients);
    },
    async getPrescriptions(patientId) {
      return clone(s.data.prescriptions.filter((rx) => rx.patientId === patientId));
    },
    async getPrescription(rxId) {
      return clone(s.data.prescriptions.find((rx) => rx.id === rxId));
    },
    async listSlots() {
      return clone(s.data.slots);
    },
    async listAppointments() {
      return clone([...s.appointments.values()]);
    },
    async reserveAppointment(appointment) {
      return serial(async () => {
        const existing = s.appointments.get(appointment.slotId);
        if (existing) return existing.patientId === appointment.patientId;
        s.appointments.set(appointment.slotId, clone(appointment));
        return true;
      });
    },
    async listOrders(patientId) {
      return clone(s.data.orders.filter((o) => patientId === undefined || o.patientId === patientId));
    },
    async saveOrder(order) {
      return serial(async () => {
        const i = s.data.orders.findIndex((o) => o.id === order.id);
        if (i >= 0) s.data.orders[i] = clone(order);
        else s.data.orders.push(clone(order));
        return clone(order);
      });
    },
    async listCards() {
      return clone(s.data.cards);
    },
    async addCard(card) {
      return serial(async () => {
        if (s.data.cards.some((c) => c.id === card.id)) throw new Error(`rule card ${card.id} already exists`);
        s.data.cards.push(clone(card));
        return clone(card);
      });
    },
    async policy() {
      return clone(s.data.policy);
    },

    async getCall(id) {
      return clone(s.calls.get(id));
    },
    async saveCall(call) {
      return serial(async () => {
        s.calls.set(call.id, clone(call));
        return clone(call);
      });
    },

    async appendRecord(input) {
      return serial(async () => {
        const seq = s.record.length + 1;
        const body: Omit<RecordEntry, "hash"> = {
          ...clone(input),
          id: `e_${String(seq).padStart(6, "0")}`,
          seq,
          at: s.now,
          prevHash: s.record.at(-1)?.hash ?? GENESIS_HASH,
        };
        const entry: RecordEntry = { ...body, hash: hashEntry(body) };
        s.record.push(entry);
        return clone(entry);
      });
    },
    async listRecord(callId) {
      return clone(s.record.filter((e) => callId === undefined || e.callId === callId));
    },

    async addQueueItem(item) {
      return serial(async () => {
        const full: QueueItem = { ...clone(item), id: nextId("q"), status: "open", createdAt: s.now };
        s.queue.push(full);
        return clone(full);
      });
    },
    async queue(lane) {
      return clone(s.queue.filter((q) => lane === undefined || q.lane === lane));
    },
    async updateQueueItem(itemId, patch) {
      return serial(async () => {
        const item = s.queue.find((q) => q.id === itemId);
        if (!item) throw new Error(`no queue item ${itemId}`);
        if (item.status !== "open") throw new Error(`queue item ${itemId} is already ${item.status}`);
        if (patch.lane !== undefined) item.lane = patch.lane;
        if (patch.signals !== undefined) item.signals = clone(patch.signals);
        if (patch.notes !== undefined) item.notes = clone(patch.notes);
        return clone(item);
      });
    },
    async decide(itemId, decision, approver, note) {
      return serial(async () => {
        const item = s.queue.find((q) => q.id === itemId);
        if (!item) throw new Error(`no queue item ${itemId}`);
        if (item.status !== "open") throw new Error(`queue item ${itemId} is already ${item.status}`);
        item.status = decision === "approve" ? "approved" : "denied";
        item.decidedBy = clone(approver);
        item.decidedAt = s.now;
        if (note !== undefined) item.decisionNote = note;
        if (item.orderId) {
          const order = s.data.orders.find((o) => o.id === item.orderId);
          if (order) order.state = item.status;
        }
        await store.appendRecord({
          callId: item.callId,
          actor: approver.role,
          kind: "approval",
          input: { itemId, decision, note, approver },
          output: { status: item.status, orderId: item.orderId },
          ruleIds: item.ruleIds,
          decision: "allowed",
          lane: item.lane,
        });
        return clone(item);
      });
    },

    async transaction(fn) {
      // All or nothing for one press and its record entry. It runs on the write queue, so while it
      // is open no other write happens, and restoring the snapshot undoes only fn's own writes.
      return serial(async () => {
        const saved = clone(s);
        try {
          return await fn();
        } catch (error) {
          s = saved;
          throw error;
        }
      });
    },

    async reset(next) {
      return serial(async () => {
        s = freshState(next);
      });
    },
  };
  // Later signals on a call move its open requests to Review (Trail #86, lib/control/relane.ts).
  return withSignalRelane(store);
}

// One store per server process, shared by every route (and kept across dev hot reloads).
const holder = globalThis as typeof globalThis & { __refillGuardStore?: Store };

/** The server's store. Role 2 swaps this one line for the Postgres store later. */
export function getStore(): Store {
  holder.__refillGuardStore ??= createMemoryStore(SEED);
  return holder.__refillGuardStore;
}
