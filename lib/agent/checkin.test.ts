import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { STILL_THERE_LINES } from "./lines";
import { collect, scriptedModel } from "./testing/scripted-model";

function setup() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store });
  const model = scriptedModel([{ text: ["Sorry, I'm here."] }]);
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: "Maple Street Pharmacy",
  });
  return { store, model, driver };
}

describe("1.8: 'Are you still there?' after a silence", () => {
  it("says the fixed line through the guard, without the model, and it's in the record", async () => {
    const { store, model, driver } = setup();
    const callId = await driver.startCall({ direction: "inbound" });
    const evs = await collect(driver.checkIn(callId));
    // 1.x (Trail #75): worded per call, always one of the fixed check-in lines.
    expect(evs).toHaveLength(1);
    const said = (evs[0] as { type: "line"; text: string }).text;
    expect(STILL_THERE_LINES).toContain(said);
    expect(model.requests).toHaveLength(0);
    expect((await store.listRecord(callId)).some((e) => e.kind === "line_spoken" && (e.input as { text: string }).text === said)).toBe(true);
  });

  it("lets the model know it asked, so the caller's next line makes sense", async () => {
    const { model, driver } = setup();
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.opening(callId));
    await collect(driver.checkIn(callId));
    await collect(driver.callerSays(callId, "Yes, sorry."));
    const seen = JSON.stringify(model.requests[0]);
    expect(STILL_THERE_LINES.some((line) => seen.includes(line))).toBe(true);
  });

  it("says nothing on an ended call", async () => {
    const { driver } = setup();
    const callId = await driver.startCall({ direction: "inbound" });
    await driver.endCall(callId);
    expect(await collect(driver.checkIn(callId))).toEqual([]);
  });
});
