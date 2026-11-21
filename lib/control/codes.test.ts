import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { CODE_SENT_TEXT, createControl } from "./press";

const sam = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };

function setup(broadcastCodes: boolean, codes = ["111111", "222222", "333333"]) {
  const store = createMemoryStore(SEED);
  const events: StreamEvent[] = [];
  let i = 0;
  const control = createControl({ store, emit: (e) => events.push(e), makeCode: () => codes[i++ % codes.length], broadcastCodes });
  return { store, events, control };
}

describe("verification codes stay off the public event stream", () => {
  it("with broadcastCodes off, the stream says a code was sent but never shows it", async () => {
    const { events, control } = setup(false);
    const callId = await control.startInboundCall();
    await control.press(callId, "lookup_patient", sam);
    const phone = events.filter((e) => e.type === "phone");
    expect(phone).toEqual([{ type: "phone", callId, kind: "code", text: CODE_SENT_TEXT }]);
    expect(JSON.stringify(events)).not.toContain("111111");
  });

  it("codeFor gives that call's latest code, which verifies", async () => {
    const { control } = setup(false);
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", sam);
    const lookupId = (lookup as { output: { lookup_id: string } }).output.lookup_id;
    await control.press(callId, "send_code", { lookup_id: lookupId });
    expect(await control.codeFor(callId)).toBe("222222");
    const code = (await control.codeFor(callId))!;
    expect(await control.press(callId, "check_code", { lookup_id: lookupId, code })).toMatchObject({ ok: true, output: { verified: true } });
  });

  it("codeFor works for outbound calls", async () => {
    const { control } = setup(false);
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("refused");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    expect(await control.codeFor(started.callId)).toBe("111111");
  });

  it("codeFor is empty for a lookup that matched nobody, another call, after 10 minutes, and after a reset", async () => {
    const { store, control } = setup(false);
    const miss = await control.startInboundCall();
    await control.press(miss, "lookup_patient", { ...sam, dob: "1990-03-15" });
    expect(await control.codeFor(miss)).toBeUndefined();

    const callId = await control.startInboundCall();
    await control.press(callId, "lookup_patient", sam);
    expect(await control.codeFor("c_9999")).toBeUndefined();
    expect(await control.codeFor(callId)).toBe("111111");

    await store.setNow(new Date(Date.parse(SEED.now) + 11 * 60 * 1000).toISOString());
    expect(await control.codeFor(callId)).toBeUndefined();

    await store.reset(SEED);
    expect(await control.codeFor(callId)).toBeUndefined();
  });

  it("with broadcastCodes on (transitional default), the old text still goes out", async () => {
    const { events, control } = setup(true);
    const callId = await control.startInboundCall();
    await control.press(callId, "lookup_patient", sam);
    expect(events.find((e) => e.type === "phone")).toMatchObject({ text: expect.stringContaining("111111") });
  });
});
