// 2.7 (Trail #83): Store.transaction on Postgres. fn's writes all stay or none do, on one
// client between BEGIN and COMMIT or ROLLBACK. Runs on PGlite in-process, never a shared
// database. The second block wraps PGlite as a pg Pool, to see which connection each
// statement went to.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Approver, Store } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { findBrokenLink } from "./memory";
import { createPostgresStore, fromPGlite, fromPgPool } from "./postgres";

type TxStore = Store & { transaction<T>(fn: () => Promise<T>): Promise<T> };
const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const boom = new Error("record write failed");

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.query("select 1");
}, 60_000);

async function writeEverything(store: Store, tag: string) {
  await store.saveCall({ id: `c_${tag}`, direction: "inbound", state: "greeting", startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] });
  await store.saveOrder({ id: `o_${tag}`, rxId: IDS.samConcerta, patientId: IDS.sam, state: "waiting_for_pharmacist", createdAt: SEED.now });
  const item = await store.addQueueItem({ callId: `c_${tag}`, patientId: IDS.sam, rxId: IDS.samConcerta, orderId: `o_${tag}`, kind: "refill", lane: "review", ruleIds: ["4"], signals: [], notes: [] });
  await store.appendRecord({ callId: `c_${tag}`, actor: "agent", kind: "button", button: "request_refill", input: { rx_id: IDS.samConcerta }, decision: "routed" });
  return item;
}

describe("Postgres store: transaction(fn)", () => {
  let store: TxStore;
  beforeEach(async () => {
    store = createPostgresStore(fromPGlite(pg), SEED) as TxStore;
    await store.reset(SEED);
  });

  it("has a transaction method", () => {
    expect(typeof store.transaction).toBe("function");
  });

  it("keeps every write when fn returns, and returns fn's value", async () => {
    const result = await store.transaction(async () => (await writeEverything(store, "ok")).id);
    expect(result).toMatch(/^q_/);
    expect(await store.getCall("c_ok")).toBeDefined();
    expect((await store.listOrders(IDS.sam)).map((o) => o.id)).toContain("o_ok");
    expect((await store.queue()).map((q) => q.id)).toContain(result);
    expect((await store.listRecord("c_ok")).map((e) => e.button)).toEqual(["request_refill"]);
  });

  it("undoes every write when fn throws, rethrows, and leaves the chain whole for the next append", async () => {
    const before = await store.listRecord();
    await expect(
      store.transaction(async () => {
        await writeEverything(store, "bad");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await store.getCall("c_bad")).toBeUndefined();
    expect((await store.listOrders(IDS.sam)).map((o) => o.id)).not.toContain("o_bad");
    expect((await store.queue()).some((q) => q.callId === "c_bad")).toBe(false);
    expect(await store.listRecord()).toEqual(before);

    // The process's cached chain head must not point at the rolled-back entry.
    const next = await store.appendRecord({ actor: "system", kind: "safety", input: { check: "after_rollback" }, decision: "allowed" });
    expect(next.seq).toBe(before.length + 1);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("joins a transaction already open: an inner one's writes go with the outer rollback", async () => {
    await expect(
      store.transaction(async () => {
        await store.transaction(() => writeEverything(store, "inner"));
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await store.getCall("c_inner")).toBeUndefined();
    expect(await store.listRecord("c_inner")).toEqual([]);
  });

  it("runs decide() and several appends inside one transaction, without waiting on itself", async () => {
    const item = await writeEverything(store, "seed");
    await store.transaction(async () => {
      await store.appendRecord({ callId: "c_seed", actor: "agent", kind: "line_spoken", input: { text: "One moment." }, decision: "allowed" });
      await store.decide(item.id, "approve", pharmacist, "ok");
      await store.appendRecord({ callId: "c_seed", actor: "agent", kind: "line_spoken", input: { text: "Done." }, decision: "allowed" });
    });
    expect((await store.listRecord("c_seed")).map((e) => e.kind)).toEqual(["button", "line_spoken", "approval", "line_spoken"]);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("an append from outside waits for the transaction, then links after it, whether it commits or rolls back", async () => {
    let outside: Promise<unknown> | undefined;
    await expect(
      store.transaction(async () => {
        await store.appendRecord({ callId: "c_x", actor: "agent", kind: "line_spoken", input: { text: "inside" }, decision: "allowed" });
        // Not awaited inside: it must wait until the transaction ends, not deadlock it.
        outside = store.appendRecord({ actor: "system", kind: "safety", input: { check: "outside" }, decision: "allowed" });
        throw boom;
      }),
    ).rejects.toBe(boom);
    await outside;
    const record = await store.listRecord();
    expect(record.map((e) => (e.input as { text?: string; check?: string }).text ?? (e.input as { check?: string }).check)).not.toContain("inside");
    expect(record.at(-1)?.input).toMatchObject({ check: "outside" });
    expect(findBrokenLink(record)).toBeNull();
  });

  it("puts the clock back if a transaction that moved it rolls back", async () => {
    await expect(
      store.transaction(async () => {
        await store.setNow("2026-11-20T10:00:00-05:00");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await store.now()).toBe(SEED.now);
  });
});

describe("Postgres store on a pg Pool: transaction(fn) uses one client", () => {
  // PGlite behind the pg Pool shape: pool.query and each client's query are tagged, so we can
  // see which connection every statement went to. One PGlite is one connection, as a client is.
  type Logged = { via: string; text: string };
  let log: Logged[];
  let released: number;
  const pool = () => {
    let clients = 0;
    return {
      query: (text: string, params?: unknown[]) => (log.push({ via: "pool", text }), pg.query(text, params)),
      async connect() {
        const name = `client${++clients}`;
        return {
          query: (text: string, params?: unknown[]) => (log.push({ via: name, text }), pg.query(text, params)),
          release: () => void released++,
        };
      },
    };
  };
  const writes = (entries: Logged[]) => entries.filter((e) => /^\s*(insert|update|with)/i.test(e.text));

  let store: TxStore;
  beforeEach(async () => {
    store = createPostgresStore(fromPgPool(pool() as never), SEED) as TxStore;
    await store.reset(SEED);
    log = [];
    released = 0;
  });

  it("sends BEGIN, every write in fn and COMMIT on the same client, then releases it", async () => {
    await store.transaction(() => writeEverything(store, "pool_ok"));
    const client = log.find((e) => e.text === "BEGIN")?.via;
    expect(client).toMatch(/^client/);
    const begin = log.findIndex((e) => e.text === "BEGIN");
    const commit = log.findIndex((e) => e.text === "COMMIT");
    expect(commit).toBeGreaterThan(begin);
    const inside = log.slice(begin + 1, commit);
    expect(writes(inside).length).toBeGreaterThanOrEqual(4);
    expect(inside.every((e) => e.via === client)).toBe(true);
    expect(released).toBe(1);
  });

  it("sends ROLLBACK on that client when fn throws, and releases it", async () => {
    await expect(
      store.transaction(async () => {
        await writeEverything(store, "pool_bad");
        throw boom;
      }),
    ).rejects.toBe(boom);
    const client = log.find((e) => e.text === "BEGIN")?.via;
    expect(log.some((e) => e.text === "ROLLBACK" && e.via === client)).toBe(true);
    expect(log.some((e) => e.text === "COMMIT")).toBe(false);
    expect(released).toBe(1);
    expect(await store.getCall("c_pool_bad")).toBeUndefined();
  });
});
