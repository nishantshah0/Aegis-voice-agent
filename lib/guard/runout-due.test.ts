import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

// Code review on main, finding 2 (high): a run-out day backs only a sentence about the supply
// running out or lasting, never "due", and never one that mentions delivery, pickup or arrival.
async function verifiedSam() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "111111" });
  const guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("refused");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "111111", dob: "1990-03-14" });
  return { guard, callId: started.callId };
}

describe("S4: Sam's run-out day (Friday) backs only running-out sentences", () => {
  it.each([
    "Your delivery is due Friday.",
    "Your refill is due Friday.",
    "Your Concerta is due Friday.",
    "Your Concerta runs out Friday, so we'll deliver it Friday.",
    "It runs out Friday and we'll bring it then, Friday.",
    "Your Concerta will run out Friday, so pick it up Friday.",
    "It runs out Friday, so it will arrive Friday.",
  ])("blocked: %s", async (s) => {
    const { guard, callId } = await verifiedSam();
    expect(await guard(callId, s)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each(["Your Concerta runs out Friday.", "Your Concerta will run out Friday.", "Your supply lasts until Friday.", "It will last until Friday."])(
    "allowed: %s",
    async (s) => {
      const { guard, callId } = await verifiedSam();
      expect((await guard(callId, s)).blocked).toBe(false);
    },
  );
});
