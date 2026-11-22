import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { fromSnapshot, toSnapshot } from "./snapshot";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

// Hosted (serverless) calls: no instance keeps a call in memory between turns, so the driver
// hands its per-call state out as plain JSON and takes it back. Two drivers over one store stand
// in for two serverless instances serving two turns of the same call.

const CODE = "112358";
const PHARMACY = "Maple Street Pharmacy";

function instance(store: ReturnType<typeof createMemoryStore>, steps: ScriptStep[]) {
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel(steps);
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: PHARMACY,
  });
  return { control, model, driver };
}

const lines = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "line" ? [e.text] : []));
const said = (events: AgentEvent[]) => lines(events).join(" ");

describe("toSnapshot / fromSnapshot", () => {
  it("round-trip Maps, Sets and nested data through JSON", () => {
    const value = { m: new Map([["rx_1", true]]), s: new Set(["a", "*"]), list: [{ n: 1, inner: new Map([["k", new Set([2])]]) }], none: undefined, text: "x" };
    const back = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(value)))) as typeof value;
    expect(back.m).toEqual(new Map([["rx_1", true]]));
    expect(back.s).toEqual(new Set(["a", "*"]));
    expect(back.list[0].inner.get("k")).toEqual(new Set([2]));
    expect(back.text).toBe("x");
  });
});

describe("a call carried between two driver instances", () => {
  it("the second instance continues the conversation the first one started", async () => {
    const store = createMemoryStore(SEED);
    const first = instance(store, [{ text: ["Thanks. What's the code, and your date of birth?"] }]);
    const callId = await first.driver.startCall({ direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
    await collect(first.driver.opening(callId));
    expect(said(await collect(first.driver.callerSays(callId, "Yes, this is Sam.")))).toBe("Thanks. What's the code, and your date of birth?");
    const saved = JSON.stringify(first.driver.exportCall(callId));

    // A fresh instance: same store, a new control and driver, nothing in memory.
    const lookup = outboundLookupId(callId);
    const second = instance(store, [
      { tools: [{ name: "check_code", input: { lookup_id: lookup, code: CODE, dob: "1990-03-14" } }] },
      { text: ["Thanks, Sam. You're verified."] },
    ]);
    expect(lines(await collect(second.driver.callerSays(callId, "It's 112358.")))).toEqual([]);
    second.driver.importCall(callId, JSON.parse(saved));
    expect(said(await collect(second.driver.callerSays(callId, `It's ${CODE}, and I was born March 14, 1990.`)))).toBe("Thanks, Sam. You're verified.");
    expect((await store.getCall(callId))?.state).toBe("verified");

    // The model on the second instance saw the whole call so far, the first turn included.
    const seen = JSON.stringify(second.model.requests[0].messages);
    expect(seen).toContain("Yes, this is Sam.");
    expect(seen).toContain("Thanks. What's the code, and your date of birth?");
    expect(second.model.requests[0].system).toContain(lookup);
  });

  it("exports nothing for a call it doesn't hold, and an export round-trips unchanged", async () => {
    const store = createMemoryStore(SEED);
    const a = instance(store, [{ text: ["Hello."] }]);
    expect(a.driver.exportCall("c_9999")).toBeUndefined();
    const callId = await a.driver.startCall({ direction: "inbound" });
    await collect(a.driver.opening(callId));
    await collect(a.driver.callerSays(callId, "Hi"));
    const once = JSON.stringify(a.driver.exportCall(callId));
    const b = instance(store, []);
    b.driver.importCall(callId, JSON.parse(once));
    expect(JSON.stringify(b.driver.exportCall(callId))).toBe(once);
  });
});
