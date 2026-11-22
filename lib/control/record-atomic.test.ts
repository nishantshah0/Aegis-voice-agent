// AUDIT fix 4 (b), reproduced: when request_refill's record write fails, the press answers
// "refused" but the order and its queue item stay, with no record entry behind them.
// Marked it.fails: a real fix needs an all-or-nothing Store write (a transaction, or delete and
// close-item methods), which is a lib/contract change. See the BLOCKED on the channel (Trail #27).
import { describe, expect, it } from "vitest";
import type { Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

describe("request_refill is all or nothing", () => {
  it.fails("leaves no order and no open queue item when its record write fails", async () => {
    const store: Store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "112358" });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused Sam");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "112358", dob: "1990-03-14" });

    const append = store.appendRecord.bind(store);
    store.appendRecord = async (entry) => {
      if (entry.button === "request_refill") throw new Error("disk full");
      return append(entry);
    };
    const result = await control.press(started.callId, "request_refill", { rx_id: IDS.samConcerta });
    expect(result).toMatchObject({ ok: false, error: "refused" });
    expect(await store.listOrders(IDS.sam)).toEqual([]);
    expect((await store.queue()).filter((q) => q.kind === "refill" && q.status === "open")).toEqual([]);
  });
});
