// Trail #86 (RT-C3): a signal after a request moves the call's open requests to Review, with a
// record entry, through the store's appendRecord hook (lib/control/relane.ts).
import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createControl } from "./press";
import { isRelaneEntry, signalOf } from "./relane";

const CODE = "112358";

async function tomQueued() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" });
  await control.press(callId, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: CODE });
  const refill = await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine });
  expect(refill).toMatchObject({ lane: "automatic", output: { state: "queued" } });
  return { store, control, callId, guard: createSpeechGuard({ store }), safety: createSafetyCheck({ store }) };
}

const refillItem = async (s: Awaited<ReturnType<typeof tomQueued>>) => (await s.store.queue()).find((q) => q.kind === "refill" && q.callId === s.callId)!;

describe("re-laning after a later signal", () => {
  it("a crisis line holds an Automatic refill in Review and puts its order back to waiting, with a record entry", async () => {
    const s = await tomQueued();
    await s.safety(s.callId, "Honestly I just want to end it all.");
    const item = await refillItem(s);
    expect(item).toMatchObject({ lane: "review", status: "open", signals: ["safety_words"] });
    expect((await s.store.listOrders(IDS.p6)).find((o) => o.id === item.orderId)?.state).toBe("waiting_for_pharmacist");
    const relane = (await s.store.listRecord(s.callId)).find(isRelaneEntry)!;
    expect(relane).toMatchObject({ actor: "system", kind: "safety", decision: "routed", lane: "review", input: { signal: "safety_words", items: [{ id: item.id, kind: "refill", from: "automatic" }] } });
    expect(findBrokenLink(await s.store.listRecord())).toBeNull();
  });

  it("a replaced line moves it too, and a second signal adds itself without another lane change", async () => {
    const s = await tomQueued();
    await s.guard(s.callId, "Your refill is approved.");
    expect(await refillItem(s)).toMatchObject({ lane: "review", signals: ["speech_guard_replacement"] });
    await s.safety(s.callId, "I took too many of them this morning.");
    expect((await refillItem(s)).signals).toEqual(["speech_guard_replacement", "safety_words"]);
    expect((await s.store.listRecord(s.callId)).filter(isRelaneEntry)).toHaveLength(2);
    // The same signal again changes nothing and writes nothing.
    await s.guard(s.callId, "It's approved.");
    expect((await s.store.listRecord(s.callId)).filter(isRelaneEntry)).toHaveLength(2);
  });

  it("only this call's open requests move; a spoken line or a plain caller line moves nothing", async () => {
    const s = await tomQueued();
    await s.guard(s.callId, "Thanks, one moment.");
    await s.safety(s.callId, "Thanks so much.");
    expect((await refillItem(s)).lane).toBe("automatic");
    // Lena's seed order isn't on this call.
    await s.guard(s.callId, "Your refill is approved.");
    expect((await s.store.queue()).filter((q) => q.lane === "review" && q.callId !== s.callId)).toEqual([]);
  });

  it("decided items stay as they were", async () => {
    const s = await tomQueued();
    const item = await refillItem(s);
    await s.store.decide(item.id, "approve", { id: "u1", name: "Test Pharmacist", role: "pharmacist" });
    await s.safety(s.callId, "I want to end it all.");
    expect((await s.store.queue()).find((q) => q.id === item.id)).toMatchObject({ status: "approved", lane: "automatic" });
  });

  it("signalOf: the system's own checks raise nothing, so the hook never loops", () => {
    const e = (over: Partial<RecordEntry>) => ({ actor: "system", kind: "safety", ...over }) as RecordEntry;
    expect(signalOf(e({ input: { check: "relane" } }))).toBeUndefined();
    expect(signalOf(e({ input: { check: "call_start" } }))).toBeUndefined();
    expect(signalOf(e({ actor: "caller" }))).toBe("safety_words");
    expect(signalOf(e({ kind: "line_blocked", actor: "agent" }))).toBe("speech_guard_replacement");
    expect(signalOf(e({ kind: "button", button: "check_code", actor: "agent", decision: "blocked" }))).toBe("failed_code_attempts");
    expect(signalOf(e({ kind: "button", button: "check_code", actor: "agent", decision: "allowed" }))).toBeUndefined();
  });
});

describe("safety words re-lane the verified patient's requests on other calls (Trail #86 review medium)", () => {
  async function laterCall(s: Awaited<ReturnType<typeof tomQueued>>, verify: boolean) {
    await s.control.endCall(s.callId);
    const callId = await s.control.startInboundCall();
    if (verify) {
      const lookup = await s.control.press(callId, "lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" });
      await s.control.press(callId, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: CODE });
    }
    return callId;
  }

  it("a crisis line on a later verified call holds the Automatic refill from the first call, in one record entry", async () => {
    const s = await tomQueued();
    const b = await laterCall(s, true);
    await s.safety(b, "I just want to end it all.");
    const item = await refillItem(s);
    expect(item).toMatchObject({ lane: "review", signals: ["safety_words"] });
    expect((await s.store.listOrders(IDS.p6)).find((o) => o.id === item.orderId)?.state).toBe("waiting_for_pharmacist");
    const relanes = (await s.store.listRecord()).filter(isRelaneEntry);
    expect(relanes).toHaveLength(1);
    expect(relanes[0]).toMatchObject({ callId: b, input: { signal: "safety_words", patient_id: IDS.p6, items: [{ id: item.id, from: "automatic" }] } });
  });

  it("an unverified call's safety words move nobody's other requests", async () => {
    const s = await tomQueued();
    const b = await laterCall(s, false);
    await s.safety(b, "I just want to end it all.");
    expect((await refillItem(s)).lane).toBe("automatic");
  });

  it("another patient's crisis on another call moves nothing of Tom's", async () => {
    const s = await tomQueued();
    await s.control.endCall(s.callId);
    const other = await s.control.startInboundCall();
    const lookup = await s.control.press(other, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
    await s.control.press(other, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: CODE });
    await s.safety(other, "I just want to end it all.");
    expect((await refillItem(s)).lane).toBe("automatic");
  });

  it("a replaced line on a later call stays a per-call signal", async () => {
    const s = await tomQueued();
    const b = await laterCall(s, true);
    await s.guard(b, "Your refill is approved.");
    expect((await refillItem(s)).lane).toBe("automatic");
  });
});

describe("failed codes re-lane the looked-up patient's requests on other calls (RT-C4)", () => {
  it("someone else's wrong code for Tom holds Tom's earlier Automatic refill", async () => {
    const s = await tomQueued();
    await s.control.endCall(s.callId);
    const b = await s.control.startInboundCall();
    const lookup = await s.control.press(b, "lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" });
    await s.control.press(b, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: "000000" });
    const item = await refillItem(s);
    expect(item).toMatchObject({ lane: "review", signals: ["failed_code_attempts"] });
    expect((await s.store.listOrders(IDS.p6)).find((o) => o.id === item.orderId)?.state).toBe("waiting_for_pharmacist");
    expect((await s.store.listRecord(b)).filter(isRelaneEntry)).toMatchObject([{ input: { signal: "failed_code_attempts", patient_id: IDS.p6 } }]);
  });

  it("wrong codes for a lookup that matched nobody move nobody's requests", async () => {
    const s = await tomQueued();
    await s.control.endCall(s.callId);
    const b = await s.control.startInboundCall();
    const lookup = await s.control.press(b, "lookup_patient", { name: "Tom Brennan", dob: "1983-09-22", rx_number: "RX-100701" });
    await s.control.press(b, "check_code", { lookup_id: lookup.ok ? lookup.output.lookup_id : "", code: "000000" });
    expect((await refillItem(s)).lane).toBe("automatic");
  });
});

