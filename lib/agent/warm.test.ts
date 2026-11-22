// 1.x (Trail #75, audit fix 1): the Agent SDK session starts during the call's
// opening, while the opener plays and the caller answers, instead of on the first
// caller line. Live run range-1: the first turn of a call took 37 s, almost all of
// it the SDK starting up.
import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentSdkModel, type SdkTurnEvent, type StartSdkSession } from "./agent-sdk";
import { createAgentDriver } from "./driver";
import { STILL_THERE } from "./lines";
import type { AgentModel, ModelRequest } from "./model";
import { collect, scriptedModel } from "./testing/scripted-model";
import { createUsageCap } from "./usage";

const result = (text: string): SdkTurnEvent => ({ type: "result", text, isError: false, subtype: "success", stopReason: "end_turn", modelCalls: 1 });

function fakeSessions() {
  const started: { system: string }[] = [];
  const sent: string[] = [];
  let warmed = 0;
  const start: StartSdkSession = (opts) => {
    started.push(opts);
    return {
      async *send(text) {
        sent.push(text);
        yield result("Hello.");
      },
      warm() {
        warmed++;
      },
      close() {},
    };
  };
  return { start, started, sent, warmed: () => warmed };
}

function driverWith(model: AgentModel) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "112358" });
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: "Maple Street Pharmacy",
  });
  return { store, control, driver };
}

describe("1.x: the SDK model warms up during the opening", () => {
  it("warm starts the session once and warms it, without sending anything or spending a model call", () => {
    const sessions = fakeSessions();
    const logged: string[] = [];
    const model = createAgentSdkModel({ startSession: sessions.start, cap: createUsageCap({ append: (_p, l) => logged.push(l) }) });
    const request: ModelRequest = { callId: "c_0001", system: "sys", messages: [], tools: [] };
    model.warm!(request);
    model.warm!(request);
    expect(sessions.started).toHaveLength(1);
    expect(sessions.warmed()).toBe(1);
    expect(sessions.sent).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("the first caller line reuses the warmed session", async () => {
    const sessions = fakeSessions();
    const model = createAgentSdkModel({ startSession: sessions.start, cap: createUsageCap({ append: () => {} }) });
    const { driver } = driverWith(model);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.opening(callId));
    expect(sessions.started).toHaveLength(1);
    expect(sessions.warmed()).toBe(1);
    await collect(driver.callerSays(callId, "Hi there."));
    expect(sessions.started).toHaveLength(1);
    expect(sessions.sent[0]).toContain("Hi there.");
  });

  it("the driver warms with the same system prompt the first turn uses, outbound after the opener and the code", async () => {
    const warmed: ModelRequest[] = [];
    const scripted = scriptedModel([{ text: ["Thanks."] }]);
    const model: AgentModel = { ...scripted, turn: scripted.turn, warm: (r) => void warmed.push(r) };
    const { control, driver } = driverWith(model);
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused the call");
    driver.joinCall(started.callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
    await collect(driver.opening(started.callId));
    expect(warmed).toHaveLength(1);
    expect(warmed[0].system).toContain("Maple Street Pharmacy calling for Sam Rivera");
    expect(warmed[0].system).toContain("The code has been sent");
    await collect(driver.callerSays(started.callId, "Yes, this is Sam."));
    expect(scripted.requests[0].system).toBe(warmed[0].system);
  });

  it("after warming, a check-in before the first caller line still reaches the model", async () => {
    const sessions = fakeSessions();
    const model = createAgentSdkModel({ startSession: sessions.start, cap: createUsageCap({ append: () => {} }) });
    const { driver } = driverWith(model);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.opening(callId));
    const [checkIn] = await collect(driver.checkIn(callId));
    await collect(driver.callerSays(callId, "Sorry, I'm here."));
    const said = (checkIn as { text: string }).text;
    expect(said).toBe(STILL_THERE);
    expect(sessions.sent[0]).toContain(said);
  });

  it("models without warm (the Messages API) work as before", async () => {
    const scripted = scriptedModel([{ text: ["Hello."] }]);
    const { driver } = driverWith(scripted);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.opening(callId));
    await collect(driver.callerSays(callId, "Hi."));
    expect(scripted.requests[0].messages[0]).toMatchObject({ role: "user" });
  });
});
