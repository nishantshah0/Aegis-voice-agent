// Every fixed line, run through the real speech guard at the point in a call where
// it is said. A fixed line the guard replaces would never be heard.
import { describe, expect, it } from "vitest";
import { createControl } from "@/lib/control";
import { createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import {
  ASK_TO_VERIFY,
  CODE_SENT,
  HOLDING,
  MISSED_DOSES_CHECK_IN,
  REFILL_SYNC_OFFER,
  SIDE_EFFECT_PASSED_ON,
  STILL_THERE,
  inboundGreeting,
  outboundOpener,
  outboundWrongPerson,
  sideEffectQuestion,
} from "./lines";

const PHARMACY = "Maple Street Pharmacy";
const CODE = "135791";

async function outboundCall() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused the call");
  const { callId, lookupId } = started;
  const verify = async () => {
    await control.press(callId, "send_code", { lookup_id: lookupId });
    await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE });
  };
  return { store, control, guard, callId, verify };
}

describe("fixed lines pass the real speech guard where they are said", () => {
  it("before verification: greeting, verification ask, code line, holding line", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store });
    const guard = createSpeechGuard({ store });
    const callId = await control.startInboundCall();
    for (const line of [inboundGreeting(PHARMACY), ASK_TO_VERIFY, CODE_SENT, HOLDING, STILL_THERE]) {
      expect(await guard(callId, line), line).toMatchObject({ blocked: false, speak: line });
    }
  });

  it("outbound: the opener, then the wrong-person line", async () => {
    const { guard, callId } = await outboundCall();
    const opener = outboundOpener(PHARMACY, "Sam Rivera");
    expect(await guard(callId, opener)).toMatchObject({ blocked: false, speak: opener });
    const wrong = outboundWrongPerson(PHARMACY);
    expect(await guard(callId, wrong)).toMatchObject({ blocked: false, speak: wrong });
  });

  it("after verification: refill sync, side-effect question, missed-doses line", async () => {
    const { guard, callId, verify } = await outboundCall();
    await verify();
    const label = SEED.prescriptions.find((rx) => rx.id === IDS.samConcerta)!.labelText;
    for (const line of [REFILL_SYNC_OFFER, sideEffectQuestion(label), MISSED_DOSES_CHECK_IN, STILL_THERE]) {
      expect(await guard(callId, line), line).toMatchObject({ blocked: false, speak: line });
    }
  });

  it("after a side-effect note: the passed-on line", async () => {
    const { control, guard, callId, verify } = await outboundCall();
    await verify();
    await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild headaches", kind: "side_effect" });
    expect(await guard(callId, SIDE_EFFECT_PASSED_ON)).toMatchObject({ blocked: false, speak: SIDE_EFFECT_PASSED_ON });
  });
});
