import { describe, expect, it } from "vitest";
import type { Approver, Store } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink, GENESIS_HASH } from "./memory";

const pharmacist: Approver = { id: "u_test", name: "Test Pharmacist", role: "pharmacist" };

/** The same handful of writes, so two runs can be compared. */
async function exercise(store: Store) {
  await store.saveCall({
    id: "c_1",
    direction: "outbound",
    state: "code_sent",
    targetPatientId: IDS.sam,
    startedAt: await store.now(),
    failedCodeTries: 0,
    callerSaid: [],
  });
  await store.appendRecord({ callId: "c_1", actor: "agent", kind: "button", button: "request_refill", input: { rx_id: IDS.samConcerta } });
  await store.saveOrder({ id: "o_1", rxId: IDS.samConcerta, patientId: IDS.sam, state: "waiting_for_pharmacist", createdAt: await store.now() });
  const item = await store.addQueueItem({
    callId: "c_1",
    patientId: IDS.sam,
    rxId: IDS.samConcerta,
    orderId: "o_1",
    kind: "refill",
    lane: "quick_check",
    ruleIds: ["4"],
    signals: [],
    notes: [],
  });
  await store.decide(item.id, "approve", pharmacist);
}

async function snapshot(store: Store) {
  return {
    now: await store.now(),
    patients: await store.listPatients(),
    orders: await store.listOrders(),
    queue: await store.queue(),
    record: await store.listRecord(),
    call: await store.getCall("c_1"),
  };
}

describe("memory store", () => {
  it("reset() gives the same state every time", async () => {
    const store = createMemoryStore();
    const before = await snapshot(store);
    await exercise(store);
    const first = await snapshot(store);
    await store.setNow("2026-11-25T15:00:00-05:00");
    await store.reset(SEED);
    expect(await snapshot(store)).toEqual(before);
    await exercise(store);
    expect(await snapshot(store)).toEqual(first);
  });

  it("returns copies, so callers can't change stored data", async () => {
    const store = createMemoryStore();
    const sam = await store.getPatient(IDS.sam);
    sam!.firstName = "Changed";
    expect((await store.getPatient(IDS.sam))?.firstName).toBe("Sam");
    expect(SEED.patients[0].firstName).toBe("Sam");
  });

  it("decide approves the order, records the approver, and refuses a second decision", async () => {
    const store = createMemoryStore();
    await exercise(store);
    const [item] = await store.queue("quick_check");
    expect(item.status).toBe("approved");
    expect(item.decidedBy).toEqual(pharmacist);
    expect((await store.listOrders(IDS.sam)).find((o) => o.id === "o_1")?.state).toBe("approved");
    const approval = (await store.listRecord("c_1")).at(-1);
    expect(approval?.kind).toBe("approval");
    expect(approval?.actor).toBe("pharmacist");
    await expect(store.decide(item.id, "deny", pharmacist)).rejects.toThrow(/already approved/);
    await expect(store.decide("q_missing", "approve", pharmacist)).rejects.toThrow(/no queue item/);
  });

  it("binds a pharmacist approval record to its signer decision", async () => {
    const store = createMemoryStore();
    await store.saveOrder({ id: "o_signed", rxId: IDS.samConcerta, patientId: IDS.sam, state: "waiting_for_pharmacist", createdAt: SEED.now });
    const item = await store.addQueueItem({ callId: "c_signed", patientId: IDS.sam, orderId: "o_signed", kind: "refill", lane: "review", ruleIds: [], signals: [], notes: [] });
    const ref = { runId: "run-synthetic", invocationId: "decision-synthetic", decisionId: "policy-synthetic" };

    await store.decide(item.id, "approve", pharmacist, undefined, ref);

    const approval = (await store.listRecord("c_signed")).find((entry) => entry.kind === "approval");
    expect(approval?.input).toMatchObject({ tracekit: ref, itemId: item.id, decision: "approve" });
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("hash chain links every entry and detects an edit", async () => {
    const store = createMemoryStore();
    await exercise(store);
    const record = await store.listRecord();
    expect(record[0].prevHash).toBe(GENESIS_HASH);
    expect(record.map((e) => e.seq)).toEqual(record.map((_, i) => i + 1));
    for (const e of record) expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(findBrokenLink(record)).toBeNull();

    const edited = record.map((e) => ({ ...e }));
    edited[0] = { ...edited[0], input: { rx_id: IDS.p4Adderall } };
    expect(findBrokenLink(edited)).toBe(1);
  });

  it("filters by patient, lane and call", async () => {
    const store = createMemoryStore();
    await exercise(store);
    expect((await store.getPrescriptions(IDS.sam)).map((r) => r.id).sort()).toEqual([IDS.samConcerta, IDS.samMetformin]);
    expect(await store.queue("review")).toEqual([]);
    expect(await store.listRecord("c_other")).toEqual([]);
    expect((await store.listOrders(IDS.p7)).map((o) => o.id)).toEqual([IDS.p7Order]);
  });

  it("rejects a clock that isn't a time", async () => {
    await expect(createMemoryStore().setNow("Tuesday")).rejects.toThrow();
  });
});
