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
  // Same clause, a condition or negation that doesn't govern the completion word (re-review).
  "Not to worry it's approved.",
  "No need to wait it's approved.",
  "You won't believe it's already approved.",
  "If you can believe it the pharmacist approved it.",
  "Cant complain it's all approved.",
  "Nothing is pending it's approved.",
  "When I checked it was approved.",
  "After all that it's approved.",
  // Past tense, double negatives and tautologies (second re-review).
  "After the pharmacist approved it, it's ready.",
  "When the pharmacist approved it, it was delivered.",
  "Once the pharmacist approved it, it shipped and it's on its way.",
  "There's no way it isn't approved.",
  "It's approved when it's approved.",
  // Done-words beyond the first seven (third review).
  "Your pharmacist signed off on it.",
  "Your refill is confirmed.",
  "Your refill is complete.",
  "It's done.",
  "You're all set.",
  "It's good to go.",
  "It's been processed.",
  "It shipped.",
  "It went out this morning.",
  // Exceptions that were too wide (fourth review).
  "The pharmacist is done with your refill.",
  "We're done with your order.",
  "Your order details are confirmed.",
  "Your refill details have been confirmed.",
  // A bare "that's confirmed" with nothing about the caller's identity (fifth review).
  "Yes, that's confirmed.",
  "That's confirmed.",
  "That is confirmed.",
  "That's confirmed, your refill is on its way.",
  "I don't know why you'd worry, it's ready.",
  "It'll be ready before it's approved.",
  "Before it's approved, it's ready.",
  // The identity clause can't excuse a bare "that's confirmed" when the order is named too.
  "Your refill and your date of birth, that's confirmed.",
  "Your prescription, your date of birth: that's confirmed.",
  "Your Concerta and your date of birth, that's confirmed.",
  // Uncertainty excuses only the word it governs, not the rest of the clause (regression on 8af6507).
  "Not sure when you'll pick it up it's approved.",
  "I'm not sure if you heard it's approved.",
  "I don't know when you'll be home it's ready.",
  "I can't say when you called, it's approved.",
  "I can't say yet when you'll hear, it's ready.",
];

const HONEST = [
  "Once a pharmacist approves it, I'll let you know.",
  "It'll be ready once it's approved.",
  S4_REPLACEMENT,
  "It's not approved yet.",
  "I'm ready when you are.",
  "Once a pharmacist approves it, it'll be ready.",
  "After the pharmacist approves it, it'll be on its way.",
  "It isn't approved yet.",
  "It's waiting for a pharmacist to approve.",
  "It hasn't been filled yet.",
  "It won't be ready until a pharmacist approves it.",
  "As soon as your refill is approved, I'll text you.",
  "Once it's approved it's ready for pickup.",
  "After it's been approved, it'll be on its way.",
  "It'll be filled once the pharmacist approves it.",
  "Once the pharmacist signs off, it'll be ready.",
  "It isn't done yet.",
  "It won't ship until a pharmacist approves it.",
  // Done-words about identity, a question to the caller, or the agent itself, never the order.
  "Your identity is confirmed.",
  "Thanks, that's confirmed: your date of birth matches.",
  "Your details are confirmed.",
  "Are you done with your questions?",
  "Are you all set?",
  "I'm all set to help.",
  "Your refill will be approved once the pharmacist signs off.",
  "It can be approved once the pharmacist reviews it.",
  "Your date of birth matches, that's confirmed.",
  // Honest lines from the live demo call (URGENT, demo step 2).
  "A pharmacist needs to check it before it is approved.",
  "I'm sorry, I don't know when it will be ready.",
  "I'm not sure when it will be ready.",
  "I'm not sure if it's ready yet.",
  "I can't say yet when it will be ready.",
  "I cannot say whether it's approved.",
];

describe("S4: a conditional only excuses its own clause", () => {
  it.each(FALSE_APPROVALS)("blocks before any approval: %s", async (sentence) => {
    expect(await guard(callId, sentence)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each(HONEST)("allows: %s", async (sentence) => {
    expect((await guard(callId, sentence)).blocked).toBe(false);
  });

  it.each([...FALSE_APPROVALS.slice(0, 2), "Your refill is confirmed.", "You're all set.", "It's good to go."])("allows once the pharmacist has approved: %s", async (sentence) => {
    const [item] = await store.queue("quick_check");
    await store.decide(item.id, "approve", { id: "u_test", name: "Test Pharmacist", role: "pharmacist" });
    expect((await guard(callId, sentence)).blocked).toBe(false);
  });
});

// Days, bookings, "sent" and prices, clause by clause (Trail #27): a filler condition such as
// "If you like," no longer switches these checks off for the whole sentence.
const FALSE_OTHER_PROMISES = [
  "If you like, we'll deliver it Friday.",
  "If you like we'll deliver it Friday.",
  "If it helps, your copay is $4.10.",
  "No need to worry we'll deliver it Friday.",
  "Once it's approved, your copay is $9.99.",
  "If you want, it's booked for Thursday morning.",
  "When you get a chance, your renewal was sent.",
  "If that matches, we'll deliver it Friday.",
  "If those details match, your renewal was sent.",
  // Filler is not a negation, and an approval condition never backs a day or a booking (re-review).
  "Don't worry it's booked.",
  "No worries I've sent the renewal request.",
  "No problem it's booked for delivery.",
  "Once it's approved we'll deliver it Friday.",
  "Never fear I've sent the renewal request.",
  "No doubt it's booked.",
  "Not a problem it's booked.",
  "No need to worry it's booked.",
  "Nothing to worry about it's booked.",
  "Not to worry I've sent the renewal request.",
  // No button backs a ready day yet (Role 1's ready_label request), so these wait for it.
  "It'll be ready Thursday once it's approved.",
  "Once it's approved, we can deliver it Thursday.",
];

const HONEST_OTHER = [
  "It's not sent yet.",
  "It's not booked yet.",
  "I haven't booked a delivery yet.",
  "We can't deliver it Friday.",
  "I haven't sent the renewal request yet.",
  "It hasn't been sent yet.",
  "Once it's booked for Friday, I'll text you.",
  "We haven't booked a delivery yet.",
  "Your renewal hasn't been sent yet.",
  "I can't deliver it Friday.",
  "Your refill was sent to the pharmacist.",
];

describe("S4: days, bookings, sent and prices are checked clause by clause", () => {
  it.each(FALSE_OTHER_PROMISES)("blocks: %s", async (sentence) => {
    expect(await guard(callId, sentence)).toMatchObject({ blocked: true, rule: "S4" });
  });

  it.each(HONEST_OTHER)("allows: %s", async (sentence) => {
    expect((await guard(callId, sentence)).blocked).toBe(false);
  });
});
