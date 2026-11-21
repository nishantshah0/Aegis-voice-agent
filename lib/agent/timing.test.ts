import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { collect, scriptedModel } from "./testing/scripted-model";

/** A clock that moves 100 ms every time it's read. */
function ticking() {
  let t = 0;
  return () => (t += 100);
}

function driverWith(steps: Parameters<typeof scriptedModel>[0]) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store });
  return createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model: scriptedModel(steps),
    pharmacyName: "Maple Street Pharmacy",
    now: ticking(),
  });
}

describe("1.6: turn timing in the driver", () => {
  it("logs, per caller line, the first model text and the first sentence through the guard", async () => {
    const driver = driverWith([{ text: ["Hello there. ", "How can I help?"] }]);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.callerSays(callId, "Hi."));
    // received at 100, first text read at 200, first sentence guarded at 300.
    expect(driver.turnTimings(callId)).toEqual([{ receivedAt: 100, firstModelTextMs: 100, firstGuardedMs: 200 }]);
  });

  it("times the first spoken sentence even when the model pressed a button first", async () => {
    const driver = driverWith([{ tools: [{ name: "order_status", input: {} }] }, { text: ["I need to verify you first."] }]);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.callerSays(callId, "Where's my order?"));
    const [turn] = driver.turnTimings(callId);
    expect(turn.firstModelTextMs).toBeGreaterThan(0);
    expect(turn.firstGuardedMs).toBeGreaterThan(turn.firstModelTextMs!);
  });

  it("doesn't count the opening as a turn, and keeps one entry per caller line", async () => {
    const driver = driverWith([{ text: ["One."] }, { text: ["Two."] }]);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.opening(callId));
    expect(driver.turnTimings(callId)).toEqual([]);
    await collect(driver.callerSays(callId, "a"));
    await collect(driver.callerSays(callId, "b"));
    expect(driver.turnTimings(callId)).toHaveLength(2);
  });
});
