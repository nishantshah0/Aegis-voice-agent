// 4.x (Trail #88), the code reviewer's findings on bf86876:
//   HIGH: an approval claimed through an anaphor ("the pharmacist already did", "they did") that
//         points back at approving in the same sentence, the agent's previous sentence or the
//         caller's last line needs the record like "it's approved"
//   LOW:  a stated booking with a tag question ("Your pickup is Wednesday 1 to 5, is that okay?")
//         is not an offer; only a slot offered in its own clause is
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

/** Sam verified, his Concerta refill pending a pharmacist. */
async function samPending(): Promise<CallId> {
  const callId = await control.startInboundCall();
  const lookup = await control.press(callId, "lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" });
  if (!lookup.ok) throw new Error("lookup");
  await control.press(callId, "check_code", { lookup_id: (lookup.output as { lookup_id: string }).lookup_id, code: CODE });
  expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist" } });
  return callId;
}

const rule = async (callId: CallId, sentence: string) => {
  const r = await guard(callId, sentence);
  return r.blocked ? r.rule : null;
};

describe("HIGH: an approval through an anaphor", () => {
  it.each([
    "I'm not able to approve it, the pharmacist already did.",
    "I can't approve refills, but the pharmacist did.",
    "I can't sign it off myself, but they already have.",
  ])("blocks %j on a pending refill", async (sentence) => {
    expect(await rule(await samPending(), sentence)).toBe("S4");
  });

  it("blocks 'The pharmacist already did.' after the agent's own line about approving", async () => {
    const callId = await samPending();
    expect(await rule(callId, "I can't approve refills myself.")).toBeNull();
    expect(await rule(callId, "The pharmacist already did.")).toBe("S4");
  });

  it("blocks 'They did.' answering the caller's question about approval", async () => {
    const callId = await samPending();
    await safety(callId, "Did the pharmacist approve it?");
    expect(await rule(callId, "They did.")).toBe("S4");
  });

  it.each([
    "I'm not able to approve it, but the pharmacist will review it.",
    "I can't approve refills, and the pharmacist hasn't yet.",
    "I can't approve it myself; a pharmacist has to.",
  ])("passes %j", async (sentence) => {
    expect(await rule(await samPending(), sentence)).toBeNull();
  });

  it("passes 'Yes, I did.' about sending the code", async () => {
    const callId = await samPending();
    await safety(callId, "Did you send me a code?");
    expect(await rule(callId, "I did.")).toBeNull();
  });
});

describe("LOW: a stated booking with a tag question is not an offer", () => {
  it.each(["Your pickup is Wednesday 1 to 5, is that okay?", "Your delivery is Thursday 9 to 12, does that work?", "It's set for Thursday 1 to 5, right?"])(
    "blocks %j with nothing booked",
    async (sentence) => {
      expect(await rule(await samPending(), sentence)).toBe("S4");
    },
  );

  it.each(["Would Wednesday 1 to 5 work?", "Would you like Thursday 9 to 12 instead?", "Thursday 1 to 5 is open too. Does that work?"])(
    "passes the offer %j",
    async (sentence) => {
      expect(await rule(await samPending(), sentence)).toBeNull();
    },
  );
});
