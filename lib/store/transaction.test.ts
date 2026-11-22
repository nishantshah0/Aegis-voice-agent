// Store.transaction (AUDIT fix 4b): all of fn's writes stay, or none do.
import { describe, expect, it } from "vitest";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "./memory";

const order = { id: "o_tx", rxId: IDS.samConcerta, patientId: IDS.sam, state: "queued" as const, createdAt: SEED.now };

describe("memory store transaction", () => {
  it("keeps every write when fn succeeds", async () => {
    const store = createMemoryStore(SEED);
    await store.transaction!(async () => {
      await store.saveOrder(order);
    });
    expect((await store.listOrders(IDS.sam)).map((o) => o.id)).toContain("o_tx");
  });

  it("rolls back every write when fn throws, and rethrows", async () => {
    const store = createMemoryStore(SEED);
    const before = await store.queue();
    await expect(
      store.transaction!(async () => {
        await store.saveOrder(order);
        await store.addQueueItem({ callId: "c_tx", patientId: IDS.sam, kind: "refill", lane: "review", ruleIds: [], signals: [], notes: [] });
        throw new Error("record write failed");
      }),
    ).rejects.toThrow("record write failed");
    expect((await store.listOrders(IDS.sam)).map((o) => o.id)).not.toContain("o_tx");
    expect(await store.queue()).toEqual(before);
  });
});
