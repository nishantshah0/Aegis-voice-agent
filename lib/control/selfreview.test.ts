import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createControl } from "./press";

describe("moving the demo clock back never resets a limit", () => {
  it("still sends at most 3 codes per patient after the clock goes back", async () => {
    const store = createMemoryStore(SEED);
    const events: StreamEvent[] = [];
    const control = createControl({ store, emit: (e) => events.push(e), makeCode: () => "111111", broadcastCodes: false });
    const callId = await control.startInboundCall();
    const sam = { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" };
    for (let i = 0; i < 3; i++) await control.press(callId, "lookup_patient", sam);
    await store.setNow("2026-11-24T08:00:00-05:00");
    await control.press(callId, "lookup_patient", sam);
    expect(events.filter((e) => e.type === "phone" && e.kind === "code")).toHaveLength(3);
  });

  it("rule 11 still counts blocks stamped after the clock was moved back", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "111111" });
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    await control.press(callId, "check_code", { lookup_id: (lookup as { output: { lookup_id: string } }).output.lookup_id, code: "111111" });
    for (let i = 0; i < 5; i++) await control.press(callId, "read_label", { rx_id: IDS.p4Adderall });
    await store.setNow("2026-11-24T09:00:00-05:00");
    // Metformin, not Concerta: an hour earlier, Concerta is 26 days old and 4b refuses it first.
    const r = await control.press(callId, "request_refill", { rx_id: IDS.samMetformin });
    expect(r.ruleIds).toContain("11");
  });

  it("a code issued 'after' the clock still isn't fresh", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "111111" });
    const callId = await control.startInboundCall();
    const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    await store.setNow("2026-11-24T09:00:00-05:00");
    const r = await control.press(callId, "check_code", { lookup_id: (lookup as { output: { lookup_id: string } }).output.lookup_id, code: "111111" });
    expect(r.ok && (r.output as { verified?: boolean }).verified).toBe(false);
  });
});
