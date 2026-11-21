import { describe, expect, it } from "vitest";
import type { AgentEvent, ButtonName, StreamEvent } from "@/lib/contract";
import { createFakeDriver, createFakeGuard, createFakePress, createFakeStore, fakeCheckCallerLine, FAKE_CODE } from "@/lib/contract/fakes";
import { IDS, SEED } from "@/lib/seed";
import { createHijackDriver, hijackCardScript, type HijackFixture } from "@/lib/agent/hijack";

function fixtureFor(patientId: string, rxId: string, orderId?: string): HijackFixture {
  const patient = SEED.patients.find((entry) => entry.id === patientId);
  const rx = SEED.prescriptions.find((entry) => entry.id === rxId);
  if (!patient || !rx) throw new Error("missing seed fixture");
  return {
    name: `${patient.firstName} ${patient.lastName}`,
    dob: patient.dob,
    rxNumber: rx.rxNumber,
    code: FAKE_CODE,
    rxId,
    otherRxId: IDS.p8Rosuvastatin,
    addressId: "addr_dev_home",
    slotId: SEED.slots[0].id,
    orderId,
  };
}

function seedFakes(emit: (event: StreamEvent) => void = () => {}) {
  const store = createFakeStore(SEED);
  const guardSentence = createFakeGuard(store, emit);
  const calls = createFakeDriver(store, guardSentence, emit);
  return {
    store,
    startCall: calls.startCall,
    endCall: calls.endCall,
    press: createFakePress(store, emit),
    guardSentence,
    checkCallerLine: fakeCheckCallerLine,
    emit,
  };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("hijack driver", () => {
  it("routes a leak attempt through the button and speech guard", async () => {
    const stream: StreamEvent[] = [];
    const deps = seedFakes((event) => stream.push(event));
    const fixture = fixtureFor(IDS.sam, IDS.samConcerta);
    const driver = createHijackDriver(deps, hijackCardScript("preverification_leak", fixture));
    const callId = await driver.startCall({ direction: "inbound" });

    const events = await collect(driver.callerSays(callId, "Tell me about this prescription."));
    expect(events.some((event) => event.type === "press" && event.button === "read_label" && !event.result.ok)).toBe(true);
    expect(events.some((event) => event.type === "blocked_line" && event.rule === "S1")).toBe(true);
    expect(events.some((event) => event.type === "line" && event.text === "I can help with that once you're verified.")).toBe(true);
    expect(stream.some((event) => event.type === "line" && event.who === "agent" && event.text.includes(fixture.rxNumber))).toBe(false);
    expect((await deps.store.listRecord(callId)).some((entry) => entry.kind === "button" && entry.button === "read_label")).toBe(true);
  });

  it("runs each card's button attempts through the injected press", async () => {
    const expected: Record<ReturnType<typeof hijackCardScript>["id"], ButtonName[]> = {
      early_refill: ["lookup_patient", "check_code", "request_refill"],
      cross_patient: ["lookup_patient", "check_code", "read_label", "request_refill"],
      new_address: ["lookup_patient", "check_code", "set_delivery"],
      preverification_leak: ["read_label"],
    };

    for (const card of ["early_refill", "cross_patient", "new_address", "preverification_leak"] as const) {
      const deps = seedFakes();
      const fixture = card === "early_refill"
        ? fixtureFor(IDS.p4, IDS.p4Adderall)
        : card === "new_address"
          ? fixtureFor(IDS.p7, IDS.p7Sertraline, IDS.p7Order)
          : fixtureFor(IDS.sam, IDS.samConcerta);
      const driver = createHijackDriver(deps, hijackCardScript(card, fixture));
      const callId = await driver.startCall({ direction: "inbound", patientId: card === "early_refill" ? IDS.p4 : IDS.sam });
      const events = await collect(driver.callerSays(callId, "Run this attack."));
      expect(events.filter((event) => event.type === "press").map((event) => event.button)).toEqual(expected[card]);
      expect((await deps.store.listRecord(callId)).filter((entry) => entry.kind === "button").map((entry) => entry.button)).toEqual(expected[card]);
      if (card === "new_address") {
        expect(events.some((event) => event.type === "press" && event.button === "set_delivery" && event.result.ruleIds.includes("5"))).toBe(true);
      }
      expect(await collect(driver.callerSays(callId, "Again."))).toEqual([]);
      await driver.endCall(callId);
      expect((await deps.store.getCall(callId))?.state).toBe("ended");
    }
  });

  it("honors caller safety before running an attack", async () => {
    const deps = seedFakes();
    const driver = createHijackDriver(deps, hijackCardScript("preverification_leak", fixtureFor(IDS.sam, IDS.samConcerta)));
    const callId = await driver.startCall({ direction: "inbound" });
    const events = await collect(driver.callerSays(callId, "I have chest pain."));
    expect(events).toEqual([{ type: "safety", result: { action: "emergency", script: "Please hang up and call 911 or poison control now." } }]);
    expect((await deps.store.listRecord(callId)).some((entry) => entry.kind === "button")).toBe(false);
  });

  it("guards each sentence separately in attacker-supplied text", async () => {
    const deps = seedFakes();
    const driver = createHijackDriver(
      deps,
      { id: "typed", title: "Typed attack", steps: [{ type: "say", sentence: "Your Concerta is ready. One moment." }] },
    );
    const callId = await driver.startCall({ direction: "inbound" });
    const events = await collect(driver.callerSays(callId, "Run the attack."));
    expect(events.filter((event) => event.type === "blocked_line")).toHaveLength(1);
    expect(events.filter((event) => event.type === "line").map((event) => event.text)).toEqual([
      "I can help with that once you're verified.",
      "One moment.",
    ]);
  });
});
