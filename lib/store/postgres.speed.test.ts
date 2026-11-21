// 2.7 (Trail #54): the Postgres store keeps round trips few, and its caches never break the
// record. Two stores on one database stand in for two servers, or for a reset this process
// didn't make.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Approver, RecordEntryInput, Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { findBrokenLink } from "./memory";
import { createPostgresStore, fromPGlite, type SqlDb } from "./postgres";

const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const entry = (callId: string): RecordEntryInput => ({ callId, actor: "system", kind: "safety", input: { check: "call_start" }, decision: "allowed" });

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.query("select 1");
}, 60_000);

/** A store on the shared PGlite that counts its round trips (BEGIN and COMMIT included). */
function countingStore() {
  const base = fromPGlite(pg);
  const counter = { n: 0 };
  const db: SqlDb = {
    query: async (text, params) => {
      counter.n++;
      return base.query(text, params);
    },
    transaction: (fn) =>
      base.transaction(async (q) => {
        counter.n += 2;
        return fn(async (text, params) => {
          counter.n++;
          return q(text, params);
        });
      }),
  };
  return { store: createPostgresStore(db, SEED), counter };
}

describe("two stores on one database", () => {
  let a: Store;
  let b: Store;
  beforeEach(async () => {
    a = createPostgresStore(fromPGlite(pg), SEED);
    b = createPostgresStore(fromPGlite(pg), SEED);
    await a.reset(SEED);
  });

  it("keep one chain when they take turns appending", async () => {
    await a.appendRecord(entry("c_a"));
    await b.appendRecord(entry("c_b"));
    await a.appendRecord(entry("c_a"));
    const record = await a.listRecord();
    expect(record.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(findBrokenLink(record)).toBeNull();
  });

  it("start a fresh chain after the other one resets", async () => {
    await a.appendRecord(entry("c_a"));
    await a.appendRecord(entry("c_a"));
    await b.reset(SEED);
    const next = await a.appendRecord(entry("c_a"));
    expect(next).toMatchObject({ seq: 1, prevHash: "0".repeat(64) });
    expect(findBrokenLink(await a.listRecord())).toBeNull();
  });

  it("chain a decision after the other one appended", async () => {
    const item = await a.addQueueItem({ callId: "c_q", patientId: IDS.sam, kind: "refill", lane: "review", ruleIds: ["4"], signals: [], notes: [] });
    await a.appendRecord(entry("c_q"));
    await b.appendRecord(entry("c_b"));
    await a.decide(item.id, "approve", pharmacist);
    const record = await a.listRecord();
    expect(record.at(-1)).toMatchObject({ kind: "approval", seq: 3 });
    expect(findBrokenLink(record)).toBeNull();
  });
});

describe("one store", () => {
  it("lands appends made at the same moment one after another, in one chain", async () => {
    const store = createPostgresStore(fromPGlite(pg), SEED);
    await store.reset(SEED);
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.appendRecord(entry(`c_${i}`))));
    const record = await store.listRecord();
    expect(record.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(findBrokenLink(record)).toBeNull();
  });

  it("numbers queue items from the counter, and its copies of seed data can't be changed by callers", async () => {
    const store = createPostgresStore(fromPGlite(pg), SEED);
    await store.reset(SEED);
    const one = await store.addQueueItem({ callId: "c_1", patientId: IDS.sam, kind: "refill", lane: "review", ruleIds: [], signals: [], notes: [] });
    const two = await store.addQueueItem({ callId: "c_2", patientId: IDS.sam, kind: "refill", lane: "quick_check", ruleIds: [], signals: [], notes: [] });
    expect([one.id, two.id]).toEqual(["q_000001", "q_000002"]);
    expect((await store.queue()).map((q) => q.id)).toEqual(["q_000001", "q_000002"]);
    const sam = await store.getPatient(IDS.sam);
    sam!.firstName = "Changed";
    expect((await store.getPatient(IDS.sam))?.firstName).not.toBe("Changed");
  });
});

describe("round trips per press (Role 0's demo timing: ~40 ms each to Tiger Cloud)", () => {
  it("stay few on Sam's outbound refill, and on reset", async () => {
    const { store, counter } = countingStore();
    await store.reset(SEED);
    const control = createControl({ store, makeCode: () => "111111" });
    const trips = async (f: () => Promise<unknown>) => {
      counter.n = 0;
      await f();
      return counter.n;
    };
    let started: { callId: string; lookupId: string } | undefined;
    const start = await trips(async () => {
      const s = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
      if (s.ok) started = s;
    });
    const { callId, lookupId } = started!;
    // Before Trail #54: 19, 8, 12, 22 and 46.
    expect(start).toBeLessThanOrEqual(8);
    expect(await trips(() => control.press(callId, "send_code", { lookup_id: lookupId }))).toBeLessThanOrEqual(3);
    expect(await trips(() => control.press(callId, "check_code", { lookup_id: lookupId, code: "111111", dob: "1990-03-14" }))).toBeLessThanOrEqual(5);
    expect(await trips(() => control.press(callId, "request_refill", { rx_id: IDS.samConcerta }))).toBeLessThanOrEqual(9);
    expect(await trips(() => store.reset(SEED))).toBeLessThanOrEqual(10);
  });
});
