import { beforeEach, describe, expect, it } from "vitest";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { finishedCalls } from "./calls";

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

// Sam's call on the real lock: verified, refill asked for, one blocked promise, a side effect.
async function samsCall() {
  const store = getStore();
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await control.press(callId, "check_code", { lookup_id: lookupId, code: (await control.codeFor(callId))!, dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await createSpeechGuard({ store, emit })(callId, "Your Concerta refill is approved.");
  await createSafetyCheck({ store, emit })(callId, "I've been sleeping badly.");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Sleeping badly", kind: "side_effect" });
  return callId;
}

describe("finishedCalls", () => {
  it("lists only calls that have ended", async () => {
    const live = await samsCall();
    expect(await finishedCalls(getStore())).toEqual([]);
    await getControl().endCall(live);
    expect((await finishedCalls(getStore())).map((c) => c.callId)).toEqual([live]);
  });

  it("gives each call's transcript, buttons pressed, blocked lines and outcome from the record", async () => {
    const callId = await samsCall();
    await getControl().endCall(callId);
    const [call] = await finishedCalls(getStore());
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.direction).toBe("outbound");
    expect(call.patient).toBe("S.R.");
    expect(call.verified).toBe(true);
    expect(call.transcript).toContainEqual({ who: "caller", text: "I've been sleeping badly." });
    expect(call.transcript).toContainEqual(expect.objectContaining({ who: "agent", text: "Your Concerta refill is approved.", blocked: "S4" }));
    expect(call.blocked).toEqual([expect.objectContaining({ text: "Your Concerta refill is approved.", rule: "S4" })]);
    expect(call.buttons.map((b) => b.button)).toEqual(["send_code", "check_code", "request_refill", "note_for_pharmacist"]);
    expect(call.buttons.find((b) => b.button === "request_refill")).toMatchObject({ decision: expect.any(String) });
    expect(call.outcome.length).toBeGreaterThan(0);
    expect(call.outcome.join(" ")).toMatch(/refill/i);
  });

  it("puts the newest call first", async () => {
    const first = await samsCall();
    await getControl().endCall(first);
    const second = await getControl().startCall({ direction: "inbound" });
    await getControl().endCall(second);
    expect((await finishedCalls(getStore())).map((c) => c.callId)).toEqual([second, first]);
  });
});
