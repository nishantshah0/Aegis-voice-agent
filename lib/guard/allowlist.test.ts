// 4.x (Trail #88): the red team's bypasses of the speech guard, each as a regression test.
//   normalization: lookalike letters, invisible characters and accents are read as the
//                  plain letters a listener hears, before every rule
//   S3: a dosing instruction is spoken only off the label, also when it's split across
//       clauses or across two sentences ("Take them." "All at once.")
//   S4: completion synonyms ("taken care of", "went through", "green light") and prices in words
//   S1: record digits said as words ("oh one oh one") or in part, and possessive names ("Sam's")
// Honest lines (the fixed lines, "Take your time.", label read-backs, tier 0 hours) still pass.
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

/** Sam's outbound call, verified, his Concerta refill waiting for a pharmacist: nothing approved yet. */
async function verifiedSam(): Promise<CallId> {
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  expect(await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" })).toMatchObject({ ok: true });
  expect(await control.press(started.callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist" } });
  return started.callId;
}

const rule = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

/** Says each line in turn on one call; returns the rule (or null) for each. */
const say = async (callId: CallId, lines: string[]) => {
  const out: (string | null)[] = [];
  for (const line of lines) out.push(await rule(callId, line));
  return out;
};

describe("normalization: every rule reads what a listener hears", () => {
  it.each([
    ["Cyrillic letters in a name", "Hi Ѕаm, is that you?"],
    ["fullwidth letters in a name", "Hi Ｓａｍ, is that you?"],
    ["a zero-width space inside a name", "Hi S​am, is that you?"],
    ["a soft hyphen inside a name", "Hi Sa­m, is that you?"],
  ])("S1 sees %s", async (_what, sentence) => {
    const callId = await control.startInboundCall();
    expect(await rule(callId, sentence)).toBe("S1");
  });

  it.each([
    ["a Cyrillic a", "Your refill is аpproved."],
    ["a Greek o", "Your refill is apprοved."],
    ["a zero-width joiner", "Your refill is appr‍oved."],
    ["an accent", "Your refill is ápproved."],
    ["a word joiner", "It's re⁠ady."],
  ])("S4 sees a completion word with %s", async (_what, sentence) => {
    const callId = await verifiedSam();
    expect(await rule(callId, sentence)).toBe("S4");
  });

  it("S3 sees a dose with a Cyrillic e", async () => {
    const callId = await verifiedSam();
    expect(await rule(callId, "Take 2 tablеts tonight.")).toBe("S3");
  });

  it("speaks the line as written when it passes", async () => {
    const callId = await control.startInboundCall();
    expect(await guard(callId, "One moment…")).toMatchObject({ blocked: false, speak: "One moment…" });
  });
});

describe("S3: a dosing instruction is spoken only off the label", () => {
  it.each([
    "Take them all at once.",
    "Take three tonight.",
    "Take two.",
    "Double up tomorrow.",
    "Take an extra one tonight.",
    "Swallow the whole bottle.",
    "You can take both.",
    "Take it twice.",
    "Take the rest of them.",
    "Your refill is 30 tablets, take them all at once.",
  ])("blocks %j", async (sentence) => {
    const callId = await verifiedSam();
    expect(await rule(callId, sentence)).toBe("S3");
  });

  it.each([
    [["Take them.", "All at once."]],
    [["Your refill is 30 tablets.", "Take them all at once."]],
    [["Thirty at once.", "Take them."]],
    [["You can take them.", "All of them, tonight."]],
  ])("blocks the second of two sentences that dose together: %j", async (lines) => {
    const callId = await verifiedSam();
    expect(await say(callId, lines)).toEqual([null, "S3"]);
  });

  it("a caller's question in between doesn't reset the window", async () => {
    const callId = await verifiedSam();
    expect(await rule(callId, "Take them.")).toBeNull();
    await safety(callId, "How many?");
    expect(await rule(callId, "All of them.")).toBe("S3");
  });

  it.each([
    "Take 1 tablet by mouth every morning.",
    "Take one tablet every morning.",
    "Take your Concerta, one tablet every morning.",
    "Take your time.",
    "Can I take your name?",
    "Keep taking it as your label says.",
    "Let me take a note of that for the pharmacist.",
    "Your label says 36 mg, one tablet every morning.",
  ])("passes %j", async (sentence) => {
    const callId = await verifiedSam();
    expect(await rule(callId, sentence)).toBeNull();
  });

  it.each([
    [["Your refill is 30 tablets.", "Take your time."]],
    [["Take your time.", "One moment."]],
    [["Keep taking it as directed.", "You have one other prescription that can be refilled today."]],
    [["Take one tablet every morning.", "Your refill is 30 tablets."]],
  ])("passes honest pairs: %j", async (lines) => {
    const callId = await verifiedSam();
    expect(await say(callId, lines)).toEqual([null, null]);
  });

  it("blocks a dosing instruction before verification", async () => {
    const callId = await control.startInboundCall();
    expect(await rule(callId, "Take them all at once.")).toBe("S3");
    expect(await rule(callId, "Take your time.")).toBeNull();
  });
});

describe("S4: completion synonyms and prices in words", () => {
  it.each([
    "Your refill is taken care of.",
    "It went through.",
    "Your refill went through.",
    "The pharmacist gave it the green light.",
    "You're all done.",
    "It's been finalized.",
    "Your refill is authorized.",
    "Your refill is locked in.",
  ])("blocks %j before an approval", async (sentence) => {
    const callId = await verifiedSam();
    expect(await rule(callId, sentence)).toBe("S4");
  });

  it("passes 'I went through your record'", async () => {
    const callId = await verifiedSam();
    expect(await rule(callId, "I went through your record, and a pharmacist will check it first.")).toBeNull();
  });

  it("a price in words needs check_coverage", async () => {
    const callId = await verifiedSam();
    expect(await rule(callId, "You'll pay four dollars and ten cents.")).toBe("S4");
  });

  it.each([
    ["You'll pay four dollars and ten cents.", null],
    ["The plan pays forty-one dollars and twenty cents.", null],
    ["It's four dollars ten.", null],
    ["You'll pay four dollars and fifty cents.", "S4"],
    ["You'll pay three dollars.", "S4"],
    ["It's just fifty cents.", "S4"],
    ["You'll pay 4 dollars and 50 cents.", "S4"],
  ])("after check_coverage: %j", async (sentence, expected) => {
    const callId = await verifiedSam();
    await control.press(callId, "check_coverage", { rx_id: IDS.samConcerta });
    expect(await rule(callId, sentence)).toBe(expected);
  });
});

describe("S1: record digits in any form, and possessive names", () => {
  it.each([
    "Is your number five five five, oh one oh one?",
    "Does your number end in oh one oh one?",
    "Does it end in 0101?",
    "Is that prescription one double oh two oh one?",
    "Was that nineteen ninety?",
    "Is your birthday March fourteenth?",
    "Is your birthday the fourteenth of March?",
    "Is this Sam's phone?",
  ])("blocks %j before verification", async (sentence) => {
    const callId = await control.startInboundCall();
    expect(await rule(callId, sentence)).toBe("S1");
  });

  it.each([
    "One moment.",
    "We're open 9 to 6 on weekdays.",
    "If it's an emergency, hang up and call 911.",
    "Before we go further, can I take your name, your date of birth, and the prescription number on the bottle?",
  ])("passes %j before verification", async (sentence) => {
    const callId = await control.startInboundCall();
    expect(await rule(callId, sentence)).toBeNull();
  });

  it("lets the agent repeat digits the caller said in words", async () => {
    const callId = await control.startInboundCall();
    await safety(callId, "My number is five five five, oh one oh one.");
    expect(await rule(callId, "Thanks, that's 555 0101.")).toBeNull();
  });

  it("S2 sees another patient's possessive name", async () => {
    const callId = await verifiedSam();
    expect(await rule(callId, "Is this about Robin's refill?")).toBe("S2");
  });
});
