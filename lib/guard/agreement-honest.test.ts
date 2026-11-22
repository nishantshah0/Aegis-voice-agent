// 4.x (Trail #88), the code reviewer's MEDIUM on main 08469114: honest yes-answers on a verified
// call must stay spoken, and must not queue a pharmacist item or move the refill. Agreement only
// counts when the caller asked something, and then the caller's line is checked against what the
// record backs: the label's own dose said as "one every morning", a share that matches the
// coverage, the caller's own date of birth. A clock time or a date is never a dose. The unsafe
// agreements (lib/guard/agreement.test.ts) stay blocked.
import { beforeEach, describe, expect, it } from "vitest";
import type { CallId, GuardSentenceFn, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createSafetyCheck } from "./safety";
import { createSpeechGuard } from "./speech";

const CODE = "112358";
let store: Store;
let control: Control;
let guard: GuardSentenceFn;
let safety: ReturnType<typeof createSafetyCheck>;

beforeEach(() => {
  store = createMemoryStore(SEED);
  control = createControl({ store, makeCode: () => CODE });
  guard = createSpeechGuard({ store });
  safety = createSafetyCheck({ store });
});

/** Sam verified, his refill pending, his label read and his coverage checked. */
async function samWithLabelAndQuote(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup");
  await control.press(callId, "check_code", { lookup_id: (lookup.output as { lookup_id: string }).lookup_id, code: CODE });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await control.press(callId, "read_label", { rx_id: IDS.samConcerta });
  await control.press(callId, "check_coverage", { rx_id: IDS.samConcerta });
  return callId;
}

const spoken = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

describe("honest yes-answers stay spoken and leave the queue alone", () => {
  it.each([
    ["So I take one every morning?", "Yes, that's right."],
    ["So my share is $4.10?", "Yes, that's right."],
    ["My birthday is March 14, 1990, right?", "Yes."],
    ["It's one tablet every morning, correct?", "Correct."],
  ])("caller %j, agent %j", async (caller, agent) => {
    const callId = await samWithLabelAndQuote();
    const before = await store.queue();
    await safety(callId, caller);
    expect(await spoken(callId, agent)).toBeNull();
    expect(await store.queue()).toEqual(before);
  });

  it("'We're open until 8 tonight.' is not a dose", async () => {
    const callId = await samWithLabelAndQuote();
    const before = await store.queue();
    expect(await spoken(callId, "We're open until 8 tonight.")).toBeNull();
    expect(await store.queue()).toEqual(before);
  });

  it.each(["We close at 9 pm.", "The pharmacist is in from 9 until 5.", "Your refill was last filled on October 28."])("%j is not a dose", async (sentence) => {
    expect(await spoken(await samWithLabelAndQuote(), sentence)).not.toBe("S3");
  });

  it("before verification, 'Sure.' after the caller gives their own details", async () => {
    const callId = await control.startInboundCall();
    await safety(callId, "It's Sam Rivera, March 14, 1990, and the number is RX-100201.");
    expect(await spoken(callId, "Sure.")).toBeNull();
    expect(await spoken(callId, "Okay.")).toBeNull();
    expect(await spoken(callId, "Thanks.")).toBeNull();
  });
});

describe("the unsafe agreements next to them stay blocked", () => {
  it.each([
    ["So I take two every morning?", "Yes, that's right.", "S3"],
    ["Can I take 30 at once?", "Yes.", "S3"],
    ["So my share is $1.00?", "Yes, that's right.", "S4"],
    ["So it's approved?", "Yes.", "S4"],
  ])("caller %j, agent %j: %s", async (caller, agent, expected) => {
    const callId = await samWithLabelAndQuote();
    await safety(callId, caller);
    expect(await spoken(callId, agent)).toBe(expected);
  });

  it("before verification, 'Yes.' to the caller's question about the record is still a confirmation", async () => {
    const callId = await control.startInboundCall();
    await safety(callId, "Is my birthday on file as March 14, 1990?");
    expect(await spoken(callId, "Yes.")).toBe("S1");
  });
});
