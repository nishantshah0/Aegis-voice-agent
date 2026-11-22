// The example lines the prompt quotes, run through the real speech guard at the
// point in a call where the model would say them.
//
// The prompt teaches the model how to word things. An example the guard blocks is
// worse than no example: the model copies it, S4 replaces the sentence, and the
// replacement counts as a speech-guard replacement, which sends the call's refill
// to Review (lib/control/press.ts:91, lanes.ts:22).
//
// Role 4's stand-in found exactly that in the wording I added: "a pharmacist will
// approve it, then it's ready Thursday" is blocked, because no button backs a
// ready day until the ready_label contract change lands. This test keeps any
// future example honest against the guard of the day.

import { describe, expect, it } from "vitest";

import { createControl } from "@/lib/control";
import { createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

import { systemPrompt } from "./prompt";

const PHARMACY = "Maple Street Pharmacy";
const CODE = "135791";

/** Every sentence the prompt puts in double quotes as wording to copy. */
export function quotedExamples(prompt: string): string[] {
  return [...prompt.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => /[a-z]/.test(s) && s.includes(" "));
}

/** A verified call with a refill waiting on a pharmacist: where the wait lines are said. */
async function callWaitingOnAPharmacist() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const guard = createSpeechGuard({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused the call");
  const { callId, lookupId } = started;
  await control.press(callId, "send_code", { lookup_id: lookupId });
  // Outbound calls confirm the date of birth with the code, or the call isn't verified.
  await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE, dob: "1990-03-14" });
  // Concerta is controlled, so rule 4 parks the refill with a pharmacist.
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  return { guard, callId };
}

describe("the prompt only quotes lines the guard allows", () => {
  it.each(["inbound", "outbound"] as const)("every example in the %s prompt passes", async (direction) => {
    const { guard, callId } = await callWaitingOnAPharmacist();
    const examples = quotedExamples(systemPrompt({ pharmacyName: PHARMACY, direction }));

    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(await guard(callId, example), example).toMatchObject({ blocked: false, speak: example });
    }
  });

  it("quotes a ready day only in the conditional form that ready_label backs", async () => {
    // ready_label landed (main e62c554): request_refill and order_status return the
    // weekday, and S4 backs "ready <day>" only in that form, and only for that day.
    const { guard, callId } = await callWaitingOnAPharmacist();
    const blocked = await guard(callId, "A pharmacist will approve it, then it's ready Thursday.");
    expect(blocked).toMatchObject({ blocked: true, rule: "S4" });

    for (const prompt of [
      systemPrompt({ pharmacyName: PHARMACY, direction: "inbound" }),
      systemPrompt({ pharmacyName: PHARMACY, direction: "outbound" }),
    ]) {
      const days = [...prompt.matchAll(/ready\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^."]*/gi)].map((m) => m[0]);
      expect(days.length).toBeGreaterThan(0);
      for (const said of days) expect(said).toMatch(/^ready \w+ once it's approved$/i);
    }
  });

  it("the quoted ready day is blocked on a call where no button returned it", async () => {
    // Before any refill or status check there's no ready_label, so the same words are replaced.
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => CODE });
    const guard = createSpeechGuard({ store });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused the call");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: CODE, dob: "1990-03-14" });
    expect(await guard(started.callId, "It should be ready Thursday once it's approved.")).toMatchObject({ blocked: true, rule: "S4" });
  });
});
