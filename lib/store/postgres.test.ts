// 2.7: the Postgres store behaves exactly like the memory store. Every check below runs
// against both, on a real Postgres (PGlite, in-process), and Sam's call on the real lock
// leaves the same hash-chained record in each.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Approver, RecordEntry, StreamEvent, Store } from "@/lib/contract";
import { applyApprovedCard, createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "./memory";
import { createPostgresStore, fromPGlite, type SqlDb } from "./postgres";

const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };

// One in-process Postgres for the file (it takes a few seconds to start); every test
// resets the store to the seed first.
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.query("select 1");
}, 60_000);

const factories: Record<string, () => Store> = {
  memory: () => createMemoryStore(SEED),
  postgres: () => createPostgresStore(fromPGlite(pg), SEED),
};

describe.each(Object.entries(factories))("%s store", (_name, make) => {
  let store: Store;
  beforeEach(async () => {
    store = make();
    await store.reset(SEED);
  });

  it("approving a rule card is all or nothing: if the record write fails, no card goes live, and a retry works (Trail #78)", async () => {
    let failRecord = true;
    const flaky: Store = {
      ...store,
      appendRecord: async (entry) => {
        if (failRecord) throw new Error("record write failed");
        return store.appendRecord(entry);
      },
    };
    const draft = { ...SEED.cards[0], id: "w1", wording: "Any antibiotic refill needs a pharmacist.", when: [{ field: "drug.class" as const, op: "=" as const, value: "antibiotic" }], then: "route" as const, approvedBy: "", approvedAt: "", live: false };
    await expect(applyApprovedCard(flaky, draft, pharmacist)).rejects.toThrow("record write failed");
    expect(await store.listCards()).toEqual(SEED.cards);
    expect((await store.listRecord()).filter((e) => e.kind === "rule_change")).toEqual([]);

    failRecord = false;
    const retry = await applyApprovedCard(flaky, draft, pharmacist);
    expect(retry).toMatchObject({ ok: true, card: { id: "w1", live: true } });
    expect((await store.listCards()).filter((c) => c.id === "w1")).toHaveLength(1);
    expect((await store.listRecord()).filter((e) => e.kind === "rule_change").map((e) => e.ruleIds)).toEqual([["w1"]]);
  });

  it("adds an approved rule card after the seed's, refuses a duplicate id, and reset drops it (AUDIT #9)", async () => {
    const card = { ...SEED.cards[0], id: "w1", wording: "Any antibiotic refill needs a pharmacist.", when: [{ field: "drug.class" as const, op: "=" as const, value: "antibiotic" }], then: "route" as const };
    await store.addCard(card);
    expect((await store.listCards()).map((c) => c.id)).toEqual([...SEED.cards.map((c) => c.id), "w1"]);
    expect((await store.listCards()).at(-1)).toEqual(card);
    await expect(store.addCard(card)).rejects.toThrow();
    await store.reset(SEED);
    expect(await store.listCards()).toEqual(SEED.cards);
  });

  it("serves the seed", async () => {
    expect(await store.now()).toBe(SEED.now);
    expect(await store.listPatients()).toEqual(SEED.patients);
    expect(await store.getPatient(IDS.sam)).toEqual(SEED.patients.find((p) => p.id === IDS.sam));
    expect(await store.getPatient("p_nobody")).toBeUndefined();
    expect(await store.getPrescriptions(IDS.sam)).toEqual(SEED.prescriptions.filter((rx) => rx.patientId === IDS.sam));
    expect(await store.getPrescription(IDS.samConcerta)).toEqual(SEED.prescriptions.find((rx) => rx.id === IDS.samConcerta));
    expect(await store.listSlots()).toEqual(SEED.slots);
    expect(await store.listOrders()).toEqual(SEED.orders);
    expect(await store.listCards()).toEqual(SEED.cards);
    expect(await store.policy()).toEqual(SEED.policy);
  });

  it("moves the clock and refuses a time that isn't one", async () => {
    await store.setNow("2026-11-25T09:00:00-05:00");
    expect(await store.now()).toBe("2026-11-25T09:00:00-05:00");
    await expect(store.setNow("not a time")).rejects.toThrow();
  });

  it("saves orders, updating in place and keeping the order of the list", async () => {
    const order = { id: "o_test", rxId: IDS.samConcerta, patientId: IDS.sam, state: "queued" as const, createdAt: SEED.now };
    await store.saveOrder(order);
    await store.saveOrder({ ...order, state: "approved" });
    const sams = await store.listOrders(IDS.sam);
    expect(sams.filter((o) => o.id === "o_test")).toEqual([{ ...order, state: "approved" }]);
    expect((await store.listOrders()).at(-1)?.id).toBe("o_test");
  });

  it("saves and reads calls", async () => {
    const call = { id: "c_test", direction: "inbound" as const, state: "greeting" as const, startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] };
    await store.saveCall(call);
    await store.saveCall({ ...call, state: "verified", lockedPatientId: IDS.sam });
    expect(await store.getCall("c_test")).toEqual({ ...call, state: "verified", lockedPatientId: IDS.sam });
    expect(await store.getCall("c_none")).toBeUndefined();
  });

  it("appends a hash-chained record, stamped with the store's clock", async () => {
    const a = await store.appendRecord({ callId: "c_1", actor: "system", kind: "safety", input: { check: "call_start" }, decision: "allowed" });
    await store.setNow("2026-11-24T10:05:00-05:00");
    const b = await store.appendRecord({ callId: "c_2", actor: "agent", kind: "line_spoken", input: { text: "Hello" }, decision: "allowed" });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect([a.id, b.id]).toEqual(["e_000001", "e_000002"]);
    expect(b.prevHash).toBe(a.hash);
    expect(b.at).toBe("2026-11-24T10:05:00-05:00");
    expect(findBrokenLink(await store.listRecord())).toBeNull();
    expect((await store.listRecord("c_2")).map((e) => e.seq)).toEqual([2]);
  });

  it("runs the queue: add, filter by lane, update, decide once, and record the approval", async () => {
    await store.saveOrder({ id: "o_q", rxId: IDS.samConcerta, patientId: IDS.sam, state: "waiting_for_pharmacist", createdAt: SEED.now });
    const item = await store.addQueueItem({ callId: "c_q", patientId: IDS.sam, orderId: "o_q", kind: "refill", lane: "quick_check", ruleIds: ["4"], signals: [], notes: [] });
    expect(item).toMatchObject({ id: "q_000001", status: "open", createdAt: SEED.now });
    expect(await store.queue("review")).toEqual([]);
    const moved = await store.updateQueueItem(item.id, { lane: "review", signals: ["side_effect"], notes: [{ id: "n_1", kind: "side_effect", text: "Sleeping badly" }] });
    expect(moved).toMatchObject({ lane: "review", signals: ["side_effect"] });
    const decided = await store.decide(item.id, "approve", pharmacist, "Chat at pickup");
    expect(decided).toMatchObject({ status: "approved", decidedBy: pharmacist, decisionNote: "Chat at pickup", decidedAt: SEED.now });
    expect((await store.listOrders(IDS.sam)).find((o) => o.id === "o_q")?.state).toBe("approved");
    const approval = (await store.listRecord("c_q")).find((e) => e.kind === "approval");
    expect(approval).toMatchObject({ actor: "pharmacist", input: { itemId: item.id, decision: "approve", approver: pharmacist } });
    await expect(store.decide(item.id, "deny", pharmacist)).rejects.toThrow(/already approved/);
    await expect(store.updateQueueItem(item.id, { lane: "automatic" })).rejects.toThrow(/already approved/);
    await expect(store.decide("q_none", "approve", pharmacist)).rejects.toThrow(/no queue item/);
  });

  it("resets to a seed, clearing calls, new orders, the queue and the record", async () => {
    await store.setNow("2026-12-01T09:00:00-05:00");
    await store.saveCall({ id: "c_r", direction: "inbound", state: "greeting", startedAt: SEED.now, failedCodeTries: 0, callerSaid: [] });
    await store.saveOrder({ id: "o_r", rxId: IDS.samConcerta, patientId: IDS.sam, state: "queued", createdAt: SEED.now });
    await store.addQueueItem({ callId: "c_r", patientId: IDS.sam, kind: "note", lane: "review", ruleIds: [], signals: [], notes: [] });
    await store.appendRecord({ actor: "system", kind: "safety", decision: "allowed" });
    await store.reset(SEED);
    expect(await store.now()).toBe(SEED.now);
    expect(await store.getCall("c_r")).toBeUndefined();
    expect(await store.listOrders()).toEqual(SEED.orders);
    expect(await store.queue()).toEqual([]);
    expect(await store.listRecord()).toEqual([]);
    expect((await store.addQueueItem({ callId: "c", patientId: IDS.sam, kind: "note", lane: "review", ruleIds: [], signals: [], notes: [] })).id).toBe("q_000001");
  });
});

// Sam's demo call on the real lock (as in scripts/integration/sam-demo.test.ts), on a store.
async function samsCall(store: Store): Promise<RecordEntry[]> {
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);
  const control = createControl({ store, emit, makeCode: () => "112358" });
  const guard = createSpeechGuard({ store, emit });
  const safety = createSafetyCheck({ store, emit });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await guard(callId, "Hi, this is Maple Street Pharmacy calling for Sam.");
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await safety(callId, "Sure, the code is 112358.");
  await control.press(callId, "check_code", { lookup_id: lookupId, code: "112358", dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await guard(callId, "Your Concerta refill is approved.");
  await safety(callId, "I've had some mild headaches in the afternoon.");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" });
  const [item] = await store.queue();
  await store.decide(item.id, "approve", pharmacist);
  await control.endCall(callId);
  return store.listRecord();
}

describe("Sam's call on the real lock", () => {
  it("leaves the same intact, hash-chained record in the memory and the Postgres store", async () => {
    const memory = await samsCall(factories.memory());
    const pgStore = factories.postgres();
    await pgStore.reset(SEED);
    const postgres = await samsCall(pgStore);
    expect(findBrokenLink(postgres)).toBeNull();
    expect(postgres.length).toBeGreaterThan(5);
    expect(postgres.map((e) => e.hash)).toEqual(memory.map((e) => e.hash));
  });
});

describe("creating a Postgres store (Trail #33)", () => {
  it("doesn't touch the database until the store is used", async () => {
    let calls = 0;
    const db = {
      query: async () => {
        calls++;
        return { rows: [{ n: 1 }] };
      },
      transaction: async <T>(fn: (q: never) => Promise<T>) => {
        calls++;
        return fn((async () => ({ rows: [] })) as never);
      },
    };
    const store = createPostgresStore(db as never, SEED);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(0);
    await store.listCards().catch(() => {});
    expect(calls).toBeGreaterThan(0);
  });
});

// Trail #78 review (medium): with a real pool, a read from outside an open transaction sees only
// committed rows. PGlite has one connection and makes that read wait for COMMIT, so this wrapper
// models a pool: during an open transaction, an outside read of the card list gets the last
// committed answer. The card approved inside must still be in listCards once it commits.
describe("an approved card after COMMIT, with reads from outside the transaction (Trail #78)", () => {
  it("isn't hidden by a card list cached from outside while the transaction was open", async () => {
    const base = fromPGlite(pg);
    let open = false;
    const committed = new Map<string, { rows: unknown[] }>();
    const db: SqlDb = {
      query: (async (text: string, params?: unknown[]) => {
        if (open && text.includes("from rg_cards") && committed.has(text)) return committed.get(text);
        const result = await base.query(text, params);
        if (text.includes("from rg_cards")) committed.set(text, result);
        return result;
      }) as SqlDb["query"],
      transaction: async (fn) => {
        open = true;
        try {
          return await base.transaction(fn);
        } finally {
          open = false;
        }
      },
    };
    const store = createPostgresStore(db, SEED);
    await store.reset(SEED);
    await store.listCards(); // cached from outside, before the approval

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const inWrite = new Promise<void>((r) => (reached = r));
    const holding: Store = {
      ...store,
      appendRecord: async (entry) => {
        reached();
        await held;
        return store.appendRecord(entry);
      },
    };
    const draft = { ...SEED.cards[0], id: "w1", wording: "Any antibiotic refill needs a pharmacist.", when: [{ field: "drug.class" as const, op: "=" as const, value: "antibiotic" }], then: "route" as const, approvedBy: "", approvedAt: "", live: false };
    const approving = applyApprovedCard(holding, draft, pharmacist);
    await inWrite;
    await store.listCards(); // an outside read in the window: the uncommitted card isn't visible yet
    release();
    expect(await approving).toMatchObject({ ok: true });
    expect((await store.listCards()).map((c) => c.id)).toContain("w1");
  });
});
