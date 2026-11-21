// 4.4 (Trail #27): a conditional word excuses a completion word only inside its own
// clause ("once it's approved"), never the whole sentence ("Approved! You don't need to call back.").
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { S4_REPLACEMENT, createSpeechGuard } from "./speech";

const CODE = "112358";
let store: Store;
let control: Control;
let guard: GuardSentenceFn;
let callId: CallId;

// Sam's outbound call, verified, his Concerta refill waiting for a pharmacist: nothing approved yet.
beforeEach(async () => {
  store = createMemoryStore(SEED);
  control = createControl({ store, makeCode: () => CODE });
  guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  callId = started.callId;
  await control.press(callId, "send_code", { lookup_id: started.lookupId });
  expect(await control.press(callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" })).toMatchObject({ ok: true, output: { verified: true } });
  expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist" } });
});

const FALSE_APPROVALS = [
  "Approved! You don't need to call back.",
  "It's approved, call us if anything changes.",
  "Your refill is approved and on its way, no need to wait.",
  "Good news, it's ready when you are.",
  "It's been filled, just come by when you can.",
  "If you like, it's approved.",
  "When you call back, your refill is ready.",
  "Once a pharmacist approves it, it'll be ready, and it's already on its way.",
];

const HONEST = [
  "Once a pharmacist approves it, I'll let you know.",
  "It'll be ready once it's approved.",
  S4_REPLACEMENT,
  "It's not approved yet.",
  "I'm ready when you are.",
  "Once a pharmacist approves it, it'll be ready.",
  "After the pharmacist approves it, it'll be on its way.",
];

describe("S4: a conditional only excuses its own clause", () => {
  it.each(FALSE_APPROVALS)("blocks before any approval: %s", async (sentence) => {
    expect(await guard(callId, sentence)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each(HONEST)("allows: %s", async (sentence) => {
    expect((await guard(callId, sentence)).blocked).toBe(false);
  });

  it.each(FALSE_APPROVALS.slice(0, 2))("allows once the pharmacist has approved: %s", async (sentence) => {
    const [item] = await store.queue("quick_check");
    await store.decide(item.id, "approve", { id: "u_test", name: "Test Pharmacist", role: "pharmacist" });
    expect((await guard(callId, sentence)).blocked).toBe(false);
  });
});
