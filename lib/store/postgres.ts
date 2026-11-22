// 2.7: the Store (DESIGN 3.5) on Postgres. Same behaviour as lib/store/memory.ts, checked by
// lib/store/postgres.test.ts against both stores. Documents are JSONB rows; the record is a
// hash chain: each entry is inserted only if the newest entry in the table is still the one it
// links to, so seq and prevHash stay right with several writers. Server-only.
//
// Speed (Role 0's demo timing, Trail #54): a round trip to Tiger Cloud is about 40 ms, so the
// store keeps them few. The seed tables (patients, prescriptions, slots, cards, policy), which
// only reset() writes, and the clock are cached in the process and written through; the newest
// record entry is cached too, and checked by the insert itself. Run one server per database: a
// second server's reset or clock change isn't seen here until this one resets (its record
// appends stay safe either way, because the insert checks the chain head).
//
// The server uses it when DATABASE_URL is set (app/api/_lib/runtime.ts):
//   createPostgresStore(fromPgPool(new Pool(poolConfig(DATABASE_URL, ca))))

import { AsyncLocalStorage } from "node:async_hooks";
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

/**
 * pg settings for a hosted database (Tiger Data). The server certificate is always verified;
 * `ca` adds a private CA to trust (Tiger Data's ca.pem from the portal). sslmode is removed
 * from the URL because pg would let it replace these settings.
 */
export function poolConfig(url: string, ca?: string): { connectionString: string; ssl: { rejectUnauthorized: true; ca?: string } } {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true } };
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

/** One insert per table: each row is an element of a JSON array, kept in order as `pos`. */
const insertAll = (table: string, withPatient: boolean) =>
  withPatient
    ? `insert into ${table} select x->>'id', x->>'patientId', (o - 1)::int, x from jsonb_array_elements($1::jsonb) with ordinality as t(x, o)`
    : `insert into ${table} select x->>'id', (o - 1)::int, x from jsonb_array_elements($1::jsonb) with ordinality as t(x, o)`;

async function loadSeed(q: Query, seed: Seed): Promise<void> {
  await q(`truncate ${TABLES.join(", ")}`);
  await q(`insert into rg_meta (id, now, policy, counters) values (1, $1, $2::jsonb, '{}'::jsonb)`, [seed.now, json(seed.policy)]);
  await q(insertAll("rg_patients", false), [json(seed.patients)]);
  await q(insertAll("rg_prescriptions", true), [json(seed.prescriptions)]);
  await q(insertAll("rg_slots", false), [json(seed.slots)]);
  await q(insertAll("rg_cards", false), [json(seed.cards)]);
  await q(insertAll("rg_orders", true), [json(seed.orders)]);
}

// ---------- The store ----------

type Doc<T> = { doc: T };
type Head = { seq: number; hash: string };
type Fixed = Pick<Seed, "patients" | "prescriptions" | "slots" | "cards" | "policy">;

/** Thrown when the newest record entry isn't the one this process thought: reload it and retry. */
class StaleHead extends Error {}
const isStale = (error: unknown) => error instanceof StaleHead || (error as { code?: string })?.code === "23505";

const copy = <T>(value: T): T => structuredClone(value);

/** The Store, with the contract's all-or-nothing transaction (AUDIT fix 4b, Trail #83). */
export type PostgresStore = Store & { transaction<T>(fn: () => Promise<T>): Promise<T> };

export function createPostgresStore(db: SqlDb, seed: Seed = SEED): PostgresStore {
  // Inside transaction(fn), every query fn makes, through any store method, goes to the
  // transaction's one client: this holds it for the async calls fn starts.
  const open = new AsyncLocalStorage<{ query: Query }>();

  // Tables are created, and the seed loaded into an empty database, on first use (never at
  // construction, so creating a store makes no connection). A failed setup is retried next time.
  let ready: Promise<void> | undefined;
  const ensureReady = () =>
    (ready ??= (async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from pg_tables where schemaname = current_schema() and tablename = any($1::text[])`,
        [TABLES],
      );
      if (rows[0].n < TABLES.length) for (const statement of SCHEMA) await db.query(statement);
      const meta = await db.query<{ n: number }>(`select count(*)::int as n from rg_meta`);
      if (meta.rows[0].n === 0) await db.transaction((q) => loadSeed(q, seed));
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  const q: Query = async (text, params) => {
    await ensureReady();
    return (open.getStore()?.query ?? db.query)(text, params);
  };
  /** A transaction for one store method; inside transaction(fn) it joins fn's. */
  const tx = async <T>(fn: (query: Query) => Promise<T>) => {
    await ensureReady();
    const current = open.getStore();
    return current ? fn(current.query) : db.transaction(fn);
  };
  const docs = async <T>(text: string, params?: unknown[]) => (await q<Doc<T>>(text, params)).rows.map((r) => r.doc);
  const first = async <T>(text: string, params?: unknown[]) => (await docs<T>(text, params))[0];

  // ----- Process caches, dropped on reset -----
  let fixed: Promise<Fixed> | undefined;
  let clock: Promise<string> | undefined;
  let head: Head | undefined;
  const forget = () => {
    fixed = undefined;
    clock = undefined;
    head = undefined;
  };
  const loadFixed = () =>
    (fixed ??= (async () => {
      const { rows } = await q<{ patients: Seed["patients"]; prescriptions: Seed["prescriptions"]; slots: Seed["slots"]; cards: Seed["cards"]; policy: Seed["policy"] }>(
        `select (select coalesce(jsonb_agg(doc order by pos), '[]') from rg_patients) as patients,
                (select coalesce(jsonb_agg(doc order by pos), '[]') from rg_prescriptions) as prescriptions,
                (select coalesce(jsonb_agg(doc order by pos), '[]') from rg_slots) as slots,
                (select coalesce(jsonb_agg(doc order by pos), '[]') from rg_cards) as cards,
                (select policy from rg_meta where id = 1) as policy`,
      );
      return rows[0];
    })().catch((error) => {
      fixed = undefined;
      throw error;
    }));
  const readClock = () =>
    (clock ??= q<{ now: string }>(`select now from rg_meta where id = 1`)
      .then((r) => r.rows[0].now)
      .catch((error) => {
        clock = undefined;
        throw error;
      }));

  // Appends from this process go one at a time, so they never race each other for a seq. A
  // transaction holds the turn for its whole length: an append from outside waits for it to
  // commit or roll back, so it never links to an entry that may still be undone, and never
  // waits on a row the transaction holds. Inside the transaction, its own appends go straight on.
  let appending: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    if (open.getStore()) return fn();
    const run = appending.then(fn, fn);
    appending = run.catch(() => undefined);
    return run;
  };

  const readHead = async (query: Query): Promise<Head> => {
    const last = (await query<Head>(`select seq, doc->>'hash' as hash from rg_record order by seq desc limit 1`)).rows[0];
    return last ?? { seq: 0, hash: GENESIS_HASH };
  };

  /** Insert the next entry in one round trip, only if `from` is still the newest entry. */
  async function insertEntry(query: Query, input: RecordEntryInput, from: Head, at: string): Promise<RecordEntry> {
    const seq = from.seq + 1;
    const body: Omit<RecordEntry, "hash"> = { ...input, id: `e_${String(seq).padStart(6, "0")}`, seq, at, prevHash: from.hash };
    const entry: RecordEntry = { ...body, hash: hashEntry(body) };
    const { rows } = await query<{ seq: number }>(
      `insert into rg_record select $1::int, $2::text, $3::jsonb
       where coalesce((select doc->>'hash' from rg_record order by seq desc limit 1), $4) = $5
       returning seq`,
      [seq, entry.callId ?? null, json(entry), GENESIS_HASH, from.hash],
    );
    if (rows.length === 0) throw new StaleHead();
    head = { seq, hash: entry.hash };
    return JSON.parse(json(entry));
  }

  /** Runs `attempt` with this process's idea of the chain head, reloading it once if it was stale. */
  const withHead = <T>(attempt: (from: Head) => Promise<T>): Promise<T> =>
    oneAtATime(async () => {
      for (let tries = 0; ; tries++) {
        try {
          return await attempt(head ?? (head = await readHead(q)));
        } catch (error) {
          head = undefined;
          if (!isStale(error) || tries >= 2) throw error;
        }
      }
    });

  async function lockedItem(query: Query, itemId: string): Promise<QueueItem> {
    const row = (await query<Doc<QueueItem>>(`select doc from rg_queue where id = $1 for update`, [itemId])).rows[0];
    if (!row) throw new Error(`no queue item ${itemId}`);
    if (row.doc.status !== "open") throw new Error(`queue item ${itemId} is already ${row.doc.status}`);
    return row.doc;
  }

  const saveItem = (query: Query, item: QueueItem) =>
    query(`update rg_queue set lane = $2, doc = $3::jsonb where id = $1`, [item.id, item.lane, json(item)]);

  const store: Store = {
    now: readClock,
    async setNow(now) {
      if (Number.isNaN(Date.parse(now))) throw new Error(`not a time: ${now}`);
      clock = undefined;
      await q(`update rg_meta set now = $1 where id = 1`, [now]);
      clock = Promise.resolve(now);
    },

    async getPatient(id) {
      return copy((await loadFixed()).patients.find((p) => p.id === id));
    },
    async listPatients() {
      return copy((await loadFixed()).patients);
    },
    async getPrescriptions(patientId) {
      return copy((await loadFixed()).prescriptions.filter((rx) => rx.patientId === patientId));
    },
    async getPrescription(rxId) {
      return copy((await loadFixed()).prescriptions.find((rx) => rx.id === rxId));
    },
    async listSlots() {
      return copy((await loadFixed()).slots);
    },
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
    async listCards() {
      return copy((await loadFixed()).cards);
    },
    async addCard(card) {
      // The primary key refuses a duplicate id (the insert throws).
      await q(`insert into rg_cards values ($1, (select coalesce(max(pos), -1) + 1 from rg_cards), $2::jsonb)`, [card.id, json(card)]);
      fixed = undefined;
      return copy(card);
    },
    async policy() {
      return copy((await loadFixed()).policy);
    },

    getCall: (id) => first(`select doc from rg_calls where id = $1`, [id]),
    async saveCall(call: Call) {
      await q(`insert into rg_calls values ($1, $2::jsonb) on conflict (id) do update set doc = excluded.doc`, [call.id, json(call)]);
      return JSON.parse(json(call));
    },

    appendRecord: async (input) => {
      const at = await readClock();
      return withHead((from) => insertEntry(q, input, from, at));
    },
    listRecord: (callId) => docs(`select doc from rg_record where $1::text is null or call_id = $1 order by seq`, [callId ?? null]),

    // One statement: bump the counter and insert the item, atomically.
    async addQueueItem(item) {
      const { rows } = await q<Doc<QueueItem>>(
        `with m as (
           update rg_meta set counters = jsonb_set(counters, '{q}', to_jsonb(coalesce((counters->>'q')::int, 0) + 1))
           where id = 1 returning (counters->>'q')::int as n, now
         )
         insert into rg_queue
         select 'q_' || lpad(m.n::text, 6, '0'), m.n, $2::text,
                $1::jsonb || jsonb_build_object('id', 'q_' || lpad(m.n::text, 6, '0'), 'status', 'open', 'createdAt', m.now)
         from m
         returning doc`,
        [json(item), item.lane],
      );
      return rows[0].doc;
    },
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
    // The decision and its record entry commit together; a stale chain head rolls both back and
    // the whole decision is tried again.
    decide: async (itemId, decision, approver: Approver, note) => {
      const now = await readClock();
      return withHead((from) =>
        tx(async (query) => {
          const item = await lockedItem(query, itemId);
          item.status = decision === "approve" ? "approved" : "denied";
          item.decidedBy = approver;
          item.decidedAt = now;
          if (note !== undefined) item.decisionNote = note;
          await saveItem(query, item);
          if (item.orderId) {
            await query(`update rg_orders set doc = jsonb_set(doc, '{state}', to_jsonb($2::text)) where id = $1`, [item.orderId, item.status]);
          }
          await insertEntry(
            query,
            {
              callId: item.callId,
              actor: approver.role,
              kind: "approval",
              input: { itemId, decision, note, approver },
              output: { status: item.status, orderId: item.orderId },
              ruleIds: item.ruleIds,
              decision: "allowed",
              lane: item.lane,
            },
            from,
            now,
          );
          return JSON.parse(json(item));
        }),
      );
    },

    reset: (next) =>
      oneAtATime(async () => {
        forget();
        await tx((query) => loadSeed(query, next));
        forget();
      }),
  };
  /**
   * Store.transaction (Trail #83): fn's writes all commit or none do. One pooled client runs
   * BEGIN, every query fn makes through this store, then COMMIT, or ROLLBACK if fn throws, and
   * the error is rethrown. A transaction inside one already open joins it. On a rollback the
   * process's cached chain head, clock and seed tables (cards) are dropped, since they may name
   * undone writes.
   */
  async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (open.getStore()) return fn();
    await ensureReady();
    return oneAtATime(async () => {
      try {
        return await db.transaction((query) => open.run({ query }, fn));
      } catch (error) {
        head = undefined;
        clock = undefined;
        fixed = undefined; // a card added inside may have been undone
        throw error;
      }
    });
  }

  return Object.assign(store, { transaction });
}
