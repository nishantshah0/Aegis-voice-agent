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
  ])("allows: %s", async (s) => {
    expect((await guard(callId, s)).blocked).toBe(false);
  });

  it.each([
    ["You pay $5 and 10 cents.", "S4"],
    ["You pay $4 and 20 cents.", "S4"],
    ["That's 60 tablets.", "S3"],
    ["Take 2 tablets every morning.", "S3"],
  ])("still blocks: %s", async (s, rule) => {
    expect(await guard(callId, s)).toMatchObject({ blocked: true, rule });
  });
});
