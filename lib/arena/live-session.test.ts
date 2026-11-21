import { describe, expect, it } from "vitest";
import { scriptedModel, collect } from "@/lib/agent/testing/scripted-model";
import { IDS, SEED } from "@/lib/seed";
import { liveSessionMaker } from "./live-session";

// A live scenario session: a fresh store from the scenario's seed, the real lock, and
// Role 1's agent driver on a given model. Here the model is scripted, so no network.

describe("liveSessionMaker", () => {
  it("runs the agent driver on the real lock and waits for room before every caller line", async () => {
    let waits = 0;
    const model = scriptedModel([{ text: ["Thanks for calling."] }]);
    const make = liveSessionMaker({ model, code: "123456", beforeTurn: async () => { waits += 1; } });
    const { store, driver } = await make(SEED, { direction: "inbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.callerSays(callId, "Hi, I need a refill."));
    await driver.endCall(callId);
    expect(waits).toBe(1);
    const record = await store.listRecord(callId);
    expect(record.some((e) => e.kind === "caller_line" && (e.input as { text?: string }).text === "Hi, I need a refill.")).toBe(true);
    expect(record.some((e) => e.kind === "line_spoken" && (e.input as { text?: string }).text === "Thanks for calling.")).toBe(true);
    expect((await store.getCall(callId))?.state).toBe("ended");
  });

  it("starts outbound calls through rule 7 for the scenario's prescription, and plays the guarded opener", async () => {
    const make = liveSessionMaker({ model: scriptedModel([]), code: "123456" });
    const session = await make(SEED, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    const callId = await session.driver.startCall({ direction: "outbound", patientId: IDS.sam });
    await session.opening!(callId);
    const record = await session.store.listRecord();
    expect(record.some((e) => e.kind === "safety" && (e.input as { check?: string }).check === "outbound" && e.decision === "allowed")).toBe(true);
    expect(record.some((e) => e.callId === callId && (e.kind === "line_spoken" || e.kind === "line_blocked"))).toBe(true);
  });

  it("says the seed patient's name in the outbound opener, as the live phone does", async () => {
    const make = liveSessionMaker({ model: scriptedModel([]), code: "123456" });
    const session = await make(SEED, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    const callId = await session.driver.startCall({ direction: "outbound", patientId: IDS.sam });
    await session.opening!(callId);
    const spoken = (await session.store.listRecord(callId)).filter((e) => e.kind === "line_spoken").map((e) => (e.input as { text: string }).text);
    expect(spoken.join(" ")).toContain("Sam Rivera");
  });

  it("never scores an attempt whose model failed: ending the call throws, so the suite reruns it", async () => {
    const failing = { async *turn(): AsyncIterable<never> { throw new Error("Live agent calls are off."); } };
    const make = liveSessionMaker({ model: failing, code: "123456" });
    const session = await make(SEED, { direction: "inbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    const callId = await session.driver.startCall({ direction: "inbound" });
    await collect(session.driver.callerSays(callId, "Hi."));
    await expect(session.driver.endCall(callId)).rejects.toThrow(/model failed.*Live agent calls are off/);
  });
});
