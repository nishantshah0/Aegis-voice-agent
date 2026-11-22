// AUDIT fix 4 (b): a press and its record entry are all or nothing. When the record write fails,
// the press answers "refused" and every write the button made is rolled back (Store.transaction),
// and nothing it would have announced on the stream goes out.
import { describe, expect, it } from "vitest";
import type { StreamEvent, Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

describe("request_refill is all or nothing", () => {
  it("leaves no order and no open queue item when its record write fails", async () => {
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

describe("send_code is all or nothing", () => {
  it("sends no code and leaves none live when its record write fails", async () => {
    const store: Store = createMemoryStore(SEED);
    const events: StreamEvent[] = [];
    const control = createControl({ store, emit: (e) => events.push(e), makeCode: () => "112358" });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused Sam");
    const append = store.appendRecord.bind(store);
    store.appendRecord = async (entry) => {
      if (entry.button === "send_code") throw new Error("disk full");
      return append(entry);
    };
    expect(await control.press(started.callId, "send_code", { lookup_id: started.lookupId })).toMatchObject({ ok: false, error: "refused" });
    expect(events.filter((e) => e.type === "phone" && e.kind === "code")).toEqual([]);
    expect(await control.codeFor(started.callId)).toBeUndefined();
  });
});
