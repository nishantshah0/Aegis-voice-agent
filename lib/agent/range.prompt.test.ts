// 1.x (Trail #75): the prompt covers every call type and the real-conversation
// cases, and each call gets its own voice so two calls never sound the same.
//
// Like prompt.test.ts, these check what the prompt asks for, not a list of
// forbidden things. prompt.guard.test.ts and the last case here run every quoted
// example through the real guard, for every call style.

import { describe, expect, it } from "vitest";

import { createControl } from "@/lib/control";
import { createSpeechGuard } from "@/lib/guard";
import { FAKE_SEED, SAM_ID } from "@/lib/contract/fakes";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

import { CODE_SENT } from "./lines";
import { CALL_STYLES, pickStyle, systemPrompt } from "./prompt";

/** Every sentence the prompt puts in double quotes as wording to copy (as in prompt.guard.test.ts). */
function quotedExamples(prompt: string): string[] {
  return [...prompt.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => /[a-z]/.test(s) && s.includes(" "));
}

const PHARMACY = "Maple Street Pharmacy";
const inbound = systemPrompt({ pharmacyName: PHARMACY, direction: "inbound" });
const outbound = systemPrompt({ pharmacyName: PHARMACY, direction: "outbound" });

describe("1.x: the prompt covers every call type", () => {
  it.each([
    ["order status", /order_status/],
    ["copay and coverage", /check_coverage/],
    ["label questions: food, alcohol, a missed dose", /food[^.]*alcohol[^.]*missed dose/i],
    ["only what the label says", /only what the label says/i],
    ["a renewal when no refills are left", /request_renewal/],
    // Worded "delivery ... pick it up": "delivered" and "picked up" are S4 done-words.
    ["delivery or pickup", /Would you like delivery, or would you rather pick it up\?/],
    ["changing a delivery time", /change a delivery time|move a delivery/i],
    ["the slot ids in the call notes", /slot id/i],
    ["a side effect: when it started and how bad", /when it started and how bad/i],
    ["a note for the pharmacist", /note_for_pharmacist/],
    ["a clean handover", /escalate/],
  ])("handles %s", (_what, pattern) => {
    expect(inbound).toMatch(pattern);
    expect(outbound).toMatch(pattern);
  });

  it("lets an inbound caller give the three details together or one at a time", () => {
    expect(inbound).toMatch(/in one go or one at a time/i);
  });
});

describe("1.x: several requests, several prescriptions", () => {
  it("takes several requests in the order they were said and confirms each", () => {
    expect(inbound).toMatch(/several things at once/i);
    expect(inbound).toMatch(/in the order they said them/i);
    expect(inbound).toMatch(/confirm each/i);
  });

  it("asks which prescription when it isn't clear, and offers to do them together", () => {
    expect(inbound).toMatch(/ask which one/i);
    expect(inbound).toMatch(/together/i);
  });
});

describe("1.x: proactive, not pushy", () => {
  it("offers delivery after a refill, and a renewal when a refill can't go ahead", () => {
    expect(inbound).toMatch(/Would you like delivery, or would you rather pick it up\?/);
    expect(inbound).toMatch(/no refills left[^.]*renewal|renewal[^.]*no refills left/i);
  });

  it("leaves the side-effect question to the phone system right after a refill", () => {
    expect(inbound).toMatch(/phone system asks the side-effect question/i);
  });
});

describe("1.x: real conversation on the phone", () => {
  it.each([
    ["interruptions and changes of mind", /interrupt/i],
    ["corrections like 'no, the other one'", /no, the other one/i],
    ["a hard-of-hearing caller, said again more slowly", /hard of hearing[^.]*more slowly/i],
    ["an upset or rushed caller", /upset or in a hurry/i],
    ["small talk, then back on track", /small talk/i],
    ["a quiet caller, checked on once", /quiet[^.]*once/i],
  ])("handles %s", (_what, pattern) => {
    expect(inbound).toMatch(pattern);
    expect(outbound).toMatch(pattern);
  });

  it("keeps each turn to one or two short sentences", () => {
    expect(inbound).toMatch(/one or two short sentences/i);
  });

  it("takes a yes to an offer that already read back the refill, and asks no second time", () => {
    // Live run range-1, outbound-sam-several-requests: Sam said "Yeah, go ahead with the
    // refill", and the agent read it back again and asked "Please say yes to confirm."
    for (const prompt of [inbound, outbound]) {
      expect(prompt).toMatch(/that offer is your read-back/i);
      expect(prompt).toMatch(/never ask them to confirm twice/i);
      expect(prompt).toMatch(/press request_refill first, then answer the rest in order/i);
    }
  });

  it("reads back once before a refill, not three times", () => {
    expect(inbound).toMatch(/once, and wait for a yes/i);
    expect(inbound).toMatch(/one read-back is enough/i);
  });
});

describe("1.x: the ready day from ready_label (main e62c554)", () => {
  it("says the ready day after a refill and on a status check, in the form S4 backs", () => {
    for (const prompt of [inbound, outbound]) {
      expect(prompt).toMatch(/ready_label/);
      expect(prompt).toMatch(/after a refill and on a status check/i);
      expect(prompt).toContain('"It should be ready Thursday once it\'s approved."');
      expect(prompt).toMatch(/only the day ready_label gave/i);
    }
  });

  it("keeps 'I don't have a ready time yet' for when no button gave a day", () => {
    expect(inbound).toMatch(/no button has given you a ready_label[^.]*I don't have a ready time yet/i);
  });
});

describe("1.x: fixes from live run range-2", () => {
  it("says the code line word for word after lookup_patient", () => {
    // Live: "If those details match our records, a verification code has been texted..."
    // SPEC Part 2, inbound step 3 wants the same words every time.
    expect(inbound).toContain(`"${CODE_SENT}"`);
    expect(inbound).toMatch(/word for word/i);
  });

  it("books a window the caller already named, in the same turn", () => {
    // Live: "can I pick it up Thursday morning?" got the refill but no booking.
    expect(inbound).toMatch(/already named a window[^.]*set_delivery/i);
    expect(inbound).toMatch(/order id request_refill returned/i);
  });

  it("confirms a booking as booked, not done", () => {
    // Live: "Done, Lena." after set_delivery was replaced by the guard.
    expect(inbound).toMatch(/booked for/i);
    expect(inbound).toMatch(/done, all set and approved are for a pharmacist's approval/i);
  });

  it("promises no callback after a note", () => {
    // Live: "they'll get back to you".
    expect(inbound).toMatch(/not whether or when they will call/i);
  });
});

describe("1.x: honest read-backs stay honest (audit fix 2)", () => {
  it("writes prices and strengths exactly as the button returned them", () => {
    // AUDIT.md fix 2: "$41 and 20 cents" and "$4 and 10 cents" were blocked, because the
    // coverage figure is "$41.20". The voice reads "$4.10" aloud (lib/voice/spoken.ts).
    expect(inbound).toMatch(/exactly as a button returned them/i);
    expect(inbound).not.toMatch(/the way a person would read them aloud/i);
  });

  it("never narrates a replaced sentence", () => {
    // AUDIT.md fix 2: "I need to correct something", "the earlier mix-up".
    expect(inbound).toMatch(/never mention it, correct it or apologise for it/i);
  });
});

describe("1.x: every call gets its own voice", () => {
  it("has several styles, and a style changes the prompt", () => {
    expect(CALL_STYLES.length).toBeGreaterThanOrEqual(4);
    const prompts = new Set(CALL_STYLES.map((style) => systemPrompt({ pharmacyName: PHARMACY, direction: "inbound", style })));
    expect(prompts.size).toBe(CALL_STYLES.length);
    for (const prompt of prompts) expect(prompt).toMatch(/vary how you acknowledge, confirm and sign off/i);
  });

  it("picks a style from the random number it is given", () => {
    expect(pickStyle(() => 0)).toBe(CALL_STYLES[0]);
    expect(pickStyle(() => 0.999)).toBe(CALL_STYLES.at(-1));
    const picked = new Set([0, 0.26, 0.51, 0.76, 0.99].map((r) => pickStyle(() => r)));
    expect(picked.size).toBeGreaterThan(1);
  });

  it("no style carries patient data or a list of forbidden things", () => {
    const sam = FAKE_SEED.patients.find((p) => p.id === SAM_ID)!;
    const rxs = FAKE_SEED.prescriptions.filter((rx) => rx.patientId === SAM_ID);
    const secrets = [sam.firstName, sam.lastName, sam.dob, ...rxs.map((rx) => rx.drug), ...rxs.map((rx) => rx.rxNumber)];
    for (const style of CALL_STYLES) {
      const prompt = systemPrompt({ pharmacyName: PHARMACY, direction: "outbound", style }).toLowerCase();
      for (const secret of secrets) expect(prompt).not.toContain(secret.toLowerCase());
      expect(prompt).not.toMatch(/\brule\s*\d|\bS[1-4]\b|\bforbidden\b|\bnot allowed\b|\byou may not\b/i);
      expect(prompt).not.toMatch(/\bcontrolled\b|\bearly\b/i);
    }
  });

  it("every quoted example in every style passes the real guard after verification", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => "135791" });
    const guard = createSpeechGuard({ store });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused the call");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    await control.press(started.callId, "check_code", { lookup_id: started.lookupId, code: "135791", dob: "1990-03-14" });
    await control.press(started.callId, "request_refill", { rx_id: IDS.samConcerta });
    for (const style of CALL_STYLES) {
      for (const direction of ["inbound", "outbound"] as const) {
        for (const example of quotedExamples(systemPrompt({ pharmacyName: PHARMACY, direction, style }))) {
          expect(await guard(started.callId, example), example).toMatchObject({ blocked: false, speak: example });
        }
      }
    }
  });
});
