// 2.7: the Store (DESIGN 3.5) on Postgres. Same behaviour as lib/store/memory.ts, checked by
// lib/store/postgres.test.ts against both stores. Documents are JSONB rows; the record is a
// hash chain appended inside a transaction that locks one meta row, so seq and prevHash stay
// right with several writers. Server-only.
//
// Swapping it in is one line in getStore():
//   createPostgresStore(fromPgPool(new Pool({ connectionString: process.env.DATABASE_URL })))

import type { Approver, Call, Order, QueueItem, RecordEntry, RecordEntryInput, Seed, Store } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { GENESIS_HASH, hashEntry } from "./memory";

// ---------- A small SQL interface that both `pg` and PGlite fit ----------

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
export type SqlDb = { query: Query; transaction<T>(fn: (query: Query) => Promise<T>): Promise<T> };

type QueryLike = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

/** PGlite (tests): it runs one connection, and has its own transaction(). */
export function fromPGlite(pg: QueryLike & { transaction<T>(fn: (tx: QueryLike) => Promise<T>): Promise<T> }): SqlDb {
  const wrap = (q: QueryLike): Query => async (text, params) => q.query(text, params) as never;
  return { query: wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

/** A `pg` Pool (Tiger Data): each transaction gets its own client. */
export function fromPgPool(pool: QueryLike & { connect(): Promise<QueryLike & { release(): void }> }): SqlDb {
  const wrap = (q: QueryLike): Query => async (text, params) => q.query(text, params) as never;
  return {
    query: wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

// ---------- Schema and seed ----------

const SCHEMA = [
  `create table if not exists rg_meta (id int primary key, now text not null, policy jsonb not null, counters jsonb not null)`,
  `create table if not exists rg_patients (id text primary key, pos int not null, doc jsonb not null)`,
  `create table if not exists rg_prescriptions (id text primary key, patient_id text not null, pos int not null, doc jsonb not null)`,
  `create table if not exists rg_slots (id text primary key, pos int not null, doc jsonb not null)`,
  `create table if not exists rg_cards (id text primary key, pos int not null, doc jsonb not null)`,
  `create table if not exists rg_orders (id text primary key, patient_id text not null, pos int not null, doc jsonb not null)`,
  `create table if not exists rg_calls (id text primary key, doc jsonb not null)`,
  `create table if not exists rg_record (seq int primary key, call_id text, doc jsonb not null)`,
  `create table if not exists rg_queue (id text primary key, pos int not null, lane text not null, doc jsonb not null)`,
];
const TABLES = ["rg_meta", "rg_patients", "rg_prescriptions", "rg_slots", "rg_cards", "rg_orders", "rg_calls", "rg_record", "rg_queue"];

const json = (value: unknown) => JSON.stringify(value);

async function loadSeed(q: Query, seed: Seed): Promise<void> {
  for (const table of TABLES) await q(`delete from ${table}`);
  await q(`insert into rg_meta (id, now, policy, counters) values (1, $1, $2::jsonb, '{}'::jsonb)`, [seed.now, json(seed.policy)]);
  for (const [pos, p] of seed.patients.entries()) await q(`insert into rg_patients values ($1, $2, $3::jsonb)`, [p.id, pos, json(p)]);
  for (const [pos, rx] of seed.prescriptions.entries()) {
    await q(`insert into rg_prescriptions values ($1, $2, $3, $4::jsonb)`, [rx.id, rx.patientId, pos, json(rx)]);
  }
  for (const [pos, s] of seed.slots.entries()) await q(`insert into rg_slots values ($1, $2, $3::jsonb)`, [s.id, pos, json(s)]);
  for (const [pos, c] of seed.cards.entries()) await q(`insert into rg_cards values ($1, $2, $3::jsonb)`, [c.id, pos, json(c)]);
  for (const [pos, o] of seed.orders.entries()) await q(`insert into rg_orders values ($1, $2, $3, $4::jsonb)`, [o.id, o.patientId, pos, json(o)]);
}

// ---------- The store ----------

type Doc<T> = { doc: T };

export function createPostgresStore(db: SqlDb, seed: Seed = SEED): Store {
  // Tables are created, and the seed loaded into an empty database, before the first call.
  const ready = (async () => {
    for (const statement of SCHEMA) await db.query(statement);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from rg_meta`);
    if (rows[0].n === 0) await db.transaction((q) => loadSeed(q, seed));
  })();
  const q: Query = async (text, params) => {
    await ready;
    return db.query(text, params);
  };
  const tx = async <T>(fn: (query: Query) => Promise<T>) => {
    await ready;
    return db.transaction(fn);
  };
  const docs = async <T>(text: string, params?: unknown[]) => (await q<Doc<T>>(text, params)).rows.map((r) => r.doc);
  const first = async <T>(text: string, params?: unknown[]) => (await docs<T>(text, params))[0];

  async function appendWith(query: Query, input: RecordEntryInput): Promise<RecordEntry> {
    const meta = (await query<{ now: string }>(`select now from rg_meta where id = 1 for update`)).rows[0];
    const last = (await query<{ seq: number; hash: string }>(`select seq, doc->>'hash' as hash from rg_record order by seq desc limit 1`)).rows[0];
    const seq = (last?.seq ?? 0) + 1;
    const body: Omit<RecordEntry, "hash"> = {
      ...input,
      id: `e_${String(seq).padStart(6, "0")}`,
      seq,
      at: meta.now,
      prevHash: last?.hash ?? GENESIS_HASH,
    };
    const entry: RecordEntry = { ...body, hash: hashEntry(body) };
    await query(`insert into rg_record values ($1, $2, $3::jsonb)`, [seq, entry.callId ?? null, json(entry)]);
    return JSON.parse(json(entry));
  }

  async function lockedItem(query: Query, itemId: string): Promise<QueueItem> {
    const row = (await query<Doc<QueueItem>>(`select doc from rg_queue where id = $1 for update`, [itemId])).rows[0];
    if (!row) throw new Error(`no queue item ${itemId}`);
    if (row.doc.status !== "open") throw new Error(`queue item ${itemId} is already ${row.doc.status}`);
    return row.doc;
  }

  const saveItem = (query: Query, item: QueueItem) =>
    query(`update rg_queue set lane = $2, doc = $3::jsonb where id = $1`, [item.id, item.lane, json(item)]);

  const store: Store = {
    async now() {
      return (await q<{ now: string }>(`select now from rg_meta where id = 1`)).rows[0].now;
    },
    async setNow(now) {
      if (Number.isNaN(Date.parse(now))) throw new Error(`not a time: ${now}`);
      await q(`update rg_meta set now = $1 where id = 1`, [now]);
    },

    getPatient: (id) => first(`select doc from rg_patients where id = $1`, [id]),
    listPatients: () => docs(`select doc from rg_patients order by pos`),
    getPrescriptions: (patientId) => docs(`select doc from rg_prescriptions where patient_id = $1 order by pos`, [patientId]),
    getPrescription: (rxId) => first(`select doc from rg_prescriptions where id = $1`, [rxId]),
    listSlots: () => docs(`select doc from rg_slots order by pos`),
    listOrders: (patientId) =>
      docs(`select doc from rg_orders where $1::text is null or patient_id = $1 order by pos`, [patientId ?? null]),
    async saveOrder(order: Order) {
      await q(
        `insert into rg_orders values ($1, $2, (select coalesce(max(pos), -1) + 1 from rg_orders), $3::jsonb)
         on conflict (id) do update set patient_id = excluded.patient_id, doc = excluded.doc`,
        [order.id, order.patientId, json(order)],
      );
      return JSON.parse(json(order));
    },
    listCards: () => docs(`select doc from rg_cards order by pos`),
    async policy() {
      return (await q<{ policy: Seed["policy"] }>(`select policy from rg_meta where id = 1`)).rows[0].policy;
    },

    getCall: (id) => first(`select doc from rg_calls where id = $1`, [id]),
    async saveCall(call: Call) {
      await q(`insert into rg_calls values ($1, $2::jsonb) on conflict (id) do update set doc = excluded.doc`, [call.id, json(call)]);
      return JSON.parse(json(call));
    },

    appendRecord: (input) => tx((query) => appendWith(query, input)),
    listRecord: (callId) => docs(`select doc from rg_record where $1::text is null or call_id = $1 order by seq`, [callId ?? null]),

    addQueueItem: (item) =>
      tx(async (query) => {
        const meta = (await query<{ now: string; counters: Record<string, number> }>(`select now, counters from rg_meta where id = 1 for update`)).rows[0];
        const n = (meta.counters.q ?? 0) + 1;
        await query(`update rg_meta set counters = $1::jsonb where id = 1`, [json({ ...meta.counters, q: n })]);
        const full: QueueItem = { ...item, id: `q_${String(n).padStart(6, "0")}`, status: "open", createdAt: meta.now };
        await query(`insert into rg_queue values ($1, $2, $3, $4::jsonb)`, [full.id, n, full.lane, json(full)]);
        return JSON.parse(json(full));
      }),
    queue: (lane) => docs(`select doc from rg_queue where $1::text is null or lane = $1 order by pos`, [lane ?? null]),
    updateQueueItem: (itemId, patch) =>
      tx(async (query) => {
        const item = await lockedItem(query, itemId);
        if (patch.lane !== undefined) item.lane = patch.lane;
        if (patch.signals !== undefined) item.signals = patch.signals;
        if (patch.notes !== undefined) item.notes = patch.notes;
        await saveItem(query, item);
        return JSON.parse(json(item));
      }),
    decide: (itemId, decision, approver: Approver, note) =>
      tx(async (query) => {
        const item = await lockedItem(query, itemId);
        const now = (await query<{ now: string }>(`select now from rg_meta where id = 1`)).rows[0].now;
        item.status = decision === "approve" ? "approved" : "denied";
        item.decidedBy = approver;
        item.decidedAt = now;
        if (note !== undefined) item.decisionNote = note;
        await saveItem(query, item);
        if (item.orderId) {
          const order = (await query<Doc<Order>>(`select doc from rg_orders where id = $1 for update`, [item.orderId])).rows[0];
          if (order) await query(`update rg_orders set doc = $2::jsonb where id = $1`, [item.orderId, json({ ...order.doc, state: item.status })]);
        }
        await appendWith(query, {
          callId: item.callId,
          actor: approver.role,
          kind: "approval",
          input: { itemId, decision, note, approver },
          output: { status: item.status, orderId: item.orderId },
          ruleIds: item.ruleIds,
          decision: "allowed",
          lane: item.lane,
        });
        return JSON.parse(json(item));
      }),

    reset: (next) => tx((query) => loadSeed(query, next)),
  };
  return store;
}
