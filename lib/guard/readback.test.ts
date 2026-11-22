// AUDIT fix 2: honest read-backs of the record were blocked. A price said as "$4 and 10 cents"
// is the coverage figure $4.10, and the label's "Qty 30" backs "30 tablets".
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

let guard: GuardSentenceFn;
let callId: CallId;

beforeEach(async () => {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => "112358" });
  guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  callId = started.callId;
  await control.press(callId, "send_code", { lookup_id: started.lookupId });
  await control.press(callId, "check_code", { lookup_id: started.lookupId, code: "112358", dob: "1990-03-14" });
  await control.press(callId, "read_label", { rx_id: IDS.samConcerta });
  await control.press(callId, "check_coverage", { rx_id: IDS.samConcerta });
});

describe("honest read-backs of the label and the coverage", () => {
  it.each([
    "The plan pays $41 and 20 cents.",
    "You pay $4 and 10 cents.",
    "The plan pays $41 and 20 cents and you pay $4 and 10 cents.",
    "Concerta 36 milligram tablets, 1 tablet every morning, 30 tablets.",
    "That's 30 tablets.",
    "Your refill is 30 tablets.",
    "Your bottle holds 30 tablets.",
    "You'll get 30 tablets.",
    "Concerta 36 mg, take 1 tablet by mouth every morning, 30 tablets.",
    "Concerta, 30 tablets.",
    "1 tablet, 30 tablets.",
    "Take 1 tablet, 30 tablets.",
  ])("allows: %s", async (s) => {
    expect((await guard(callId, s)).blocked).toBe(false);
  });

  it.each([
    ["You pay $5 and 10 cents.", "S4"],
    ["You pay $4 and 20 cents.", "S4"],
    ["That's 60 tablets.", "S3"],
    ["Take 2 tablets every morning.", "S3"],
    // The label's Qty is the supply, never a dose (re-review).
    ["Take 30 tablets every morning.", "S3"],
    ["Take 30 tablets.", "S3"],
    ["Take thirty tablets at once.", "S3"],
    ["You can take 30 tablets a day.", "S3"],
    // The dose in another clause still makes it a dose (second re-review).
    ["Your refill is 30 tablets, take them all at once.", "S3"],
    ["Your refill is 30 tablets and you can take them all today.", "S3"],
    ["You'll get 30 tablets; swallow them together.", "S3"],
    ["30 tablets. Take them all.", "S3"],
    ["Your bottle has 30 tablets, have them all tonight.", "S3"],
    // Only a supply phrase is backed by the label's Qty (allow-list, third re-review).
    ["Your dose is 30 tablets.", "S3"],
    ["Pop 30 tablets tonight.", "S3"],
    ["Eat 30 tablets before bed.", "S3"],
    ["Consume 30 tablets now.", "S3"],
    ["Try swallowing 30 tablets.", "S3"],
    ["Having 30 tablets tonight is fine.", "S3"],
    ["Down 30 tablets in one go.", "S3"],
    ["30 tablets tonight is fine.", "S3"],
    ["30 tablets in one sitting is safe.", "S3"],
    ["Doctors recommend 30 tablets.", "S3"],
    ["Using 30 tablets tonight is safe.", "S3"],
    ["Get through 30 tablets tonight.", "S3"],
    ["Finish 30 tablets by tomorrow.", "S3"],
    ["Your refill is 30 tablets, finish it tonight.", "S3"],
    // Every other clause must come from the label, or be empty (fourth re-review).
    ["Take, 30 tablets.", "S3"],
    ["Swallow, 30 tablets.", "S3"],
    ["Your dose tonight, 30 tablets.", "S3"],
    ["For tonight's dose, 30 tablets.", "S3"],
    ["In one go: 30 tablets.", "S3"],
    ["Tonight, 30 tablets.", "S3"],
    ["Your refill is 30 tablets; take the whole bottle tonight.", "S3"],
    ["Your refill is 30 tablets, so take every one tonight.", "S3"],
    ["Your refill is 30 tablets, and you can down the lot tonight.", "S3"],
    ["Your refill is 30 tablets; one now and the rest tonight.", "S3"],
    ["Your refill is 30 tablets, double the dose.", "S3"],
    ["Take by mouth, 30 tablets.", "S3"],
    // A label clause can't drop the dose and keep the frequency (fifth re-review).
    ["Concerta every morning, 30 tablets.", "S3"],
    ["Concerta 36 milligram tablets every morning, 30 tablets.", "S3"],
    ["Concerta take by mouth every morning, 30 tablets.", "S3"],
    ["Concerta tablet every morning; 30 tablets.", "S3"],
  ])("still blocks: %s", async (s, rule) => {
    expect(await guard(callId, s)).toMatchObject({ blocked: true, rule });
  });
});
