// 4.x (Trail #88), round 4, from the code reviewer's post-merge check on bf86876:
//   MEDIUM over-block: "takes" with a duration ("It takes a couple of days.") is not a dose, so
//   it never queues a pharmacist item or moves the refill to Review
//   a dose added beyond the label's own ("then a second one at noon") is blocked
//   pickup readiness before an approval ("come grab it now") is blocked
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSpeechGuard } from "./speech";

const CODE = "112358";
let store: Store;
let control: Control;
let guard: GuardSentenceFn;

beforeEach(() => {
  store = createMemoryStore(SEED);
  control = createControl({ store, makeCode: () => CODE });
  guard = createSpeechGuard({ store });
});

/** An inbound call verified as Sam, his Concerta refill waiting for a pharmacist. */
async function samWithRefill(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup");
  await control.press(callId, "check_code", { lookup_id: (lookup.output as { lookup_id: string }).lookup_id, code: CODE });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  return callId;
}

const rule = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

describe("a duration is not a dose", () => {
  it.each([
    "It takes a couple of days.",
    "It usually takes about two days to fill a refill.",
    "A flu shot takes about 10 minutes.",
    "Delivery takes a few hours.",
    "That can take a while.",
    "Refills take up to 2 days.",
  ])("passes %j and leaves the queue alone", async (sentence) => {
    const callId = await samWithRefill();
    const before = await store.queue();
    expect(await rule(callId, sentence)).toBeNull();
    expect(await store.queue()).toEqual(before);
  });

  it.each(["Take 2 tablets for 3 days.", "Take one every 4 hours.", "Take two a day for a week."])("still blocks the dose in %j", async (sentence) => {
    expect(await rule(await samWithRefill(), sentence)).toBe("S3");
  });
});

describe("a dose added beyond the label's own", () => {
  it.each([
    "Take 1 tablet every morning, then a second one at noon.",
    "Take 1 tablet every morning, and a second dose at lunch.",
    "Take 1 tablet every morning, plus one more at dinner.",
  ])("blocks %j", async (sentence) => {
    expect(await rule(await samWithRefill(), sentence)).toBe("S3");
  });

  it.each(["Take 1 tablet every morning.", "Give me a second to check.", "Take 1 tablet every morning, with or without food."])(
    "passes %j",
    async (sentence) => {
      expect(await rule(await samWithRefill(), sentence)).toBeNull();
    },
  );
});

describe("pickup readiness needs an approval", () => {
  it.each(["You can come grab it now.", "Come pick it up whenever you like."])("blocks %j", async (sentence) => {
    expect(await rule(await samWithRefill(), sentence)).toBe("S4");
  });
});
