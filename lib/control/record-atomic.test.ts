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

describe("concurrent presses keep their own events and writes (Trail #83 review)", () => {
  it("one call's failed press never drops or rolls back another call's code", async () => {
    const store: Store = createMemoryStore(SEED);
    const events: StreamEvent[] = [];
    const control = createControl({ store, emit: (e) => events.push(e), makeCode: () => "112358" });
    const a = await control.startInboundCall();
    const b = await control.startInboundCall();
    const lookA = await control.press(a, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    const lookB = await control.press(b, "lookup_patient", { name: "Jordan Leclair", dob: "1975-07-02", rx_number: "RX-100301" });
    const idA = lookA.ok ? (lookA.output as { lookup_id: string }).lookup_id : "";
    const idB = lookB.ok ? (lookB.output as { lookup_id: string }).lookup_id : "";
    events.length = 0;

    const append = store.appendRecord.bind(store);
    store.appendRecord = async (entry) => {
      await new Promise((r) => setTimeout(r, 5));
      if (entry.callId === b && entry.button === "send_code") throw new Error("disk full");
      return append(entry);
    };
    const [ra, rb] = await Promise.all([control.press(a, "send_code", { lookup_id: idA }), control.press(b, "send_code", { lookup_id: idB })]);
    expect(ra).toMatchObject({ ok: true });
    expect(rb).toMatchObject({ ok: false, error: "refused" });
    expect(events.filter((e) => e.type === "phone" && e.kind === "code").map((e) => (e as { callId: string }).callId)).toEqual([a]);
    expect(await control.codeFor(a)).toBe("112358");
    expect(await control.codeFor(b)).toBeUndefined();
  });
});
