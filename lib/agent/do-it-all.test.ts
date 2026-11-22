// 1.x (Nishant: "make sure this agent can do it all"), on main 2f66f93's verified
// patient services. The lock builds the read-backs (history_readback, coverage_readback,
// supply_text, availability_text, confirmation_text) and the guard lets each one through
// only as the exact sentence. So the agent must:
//   1. use a caller's corrected value, say it back once, and never press with the old one;
//   2. map varied phrasing to the right button and say its read-back word for word;
//   3. stay the pharmacy assistant when a persona request comes with a real booking;
//   4. vary only the words around a read-back, never the read-back.
// The prompt teaches it; these tests check the prompt says so and that the wording it
// teaches passes the real guard on main's real lock.

import { describe, expect, it } from "vitest";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import { coverageFacts, lastFillFacts } from "@/lib/contract/patient-facts";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { STAY_ON_TASK_NOTE } from "./persona";
import { CALL_STYLES, systemPrompt } from "./prompt";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const PHARMACY = SEED.pharmacyName;
const inbound = systemPrompt({ pharmacyName: PHARMACY, direction: "inbound" });
const outbound = systemPrompt({ pharmacyName: PHARMACY, direction: "outbound" });
const both = [inbound, outbound];

describe("1.x: self-corrections", () => {
  it.each([
    ["uses only the corrected value", /use only the corrected value/i],
    ["says it back once", /say it back once/i],
    ["never presses with a value taken back", /never press lookup_patient, check_code or any other button with a value they took back/i],
    ["asks once when it can't tell", /can't tell which they meant, ask once/i],
    ["dates, days and supplies alike", /March, I mean April[^.]*the 14th, no wait, the 15th[^.]*Tuesday, actually Wednesday[^.]*two weeks, sorry, one week/i],
  ])("%s", (_what, pattern) => {
    for (const prompt of both) expect(prompt).toMatch(pattern);
  });
});

describe("1.x: a corrected identity detail isn't said back before verification (live run do-it-all-sonnet)", () => {
  it("the prompt says to use it, not repeat it, until verified", () => {
    for (const prompt of both) expect(prompt).toMatch(/before they're verified, don't say a date of birth, name or prescription number back/i);
  });

  it("because S1 replaces a date of birth said back in other words before verification", async () => {
    // Live: "My birthday is September 20th, no wait, the 21st, 1983." then "That's September 21st, 1983." (S1).
    const store = createMemoryStore(SEED);
    const control = createControl({ store });
    const guard = createSpeechGuard({ store });
    const callId = await control.startInboundCall();
    await store.appendRecord({ callId, actor: "caller", kind: "caller_line", input: { text: "My birthday is September 20th, no wait, the 21st, 1983." }, decision: "allowed" });
    expect(await guard(callId, "That's September 21st, 1983.")).toMatchObject({ blocked: true, rule: "S1" });
  });
});

describe("1.x: varied phrasing, exact read-backs", () => {
  it.each(["history_readback", "coverage_readback", "supply_text", "availability_text", "confirmation_text"])("says %s word for word", (field) => {
    for (const prompt of both) expect(prompt).toContain(field);
  });

  it("says a read-back as its own sentence, unchanged, and varies only the words around it", () => {
    for (const prompt of both) {
      expect(prompt).toMatch(/word for word, as its own sentence/i);
      expect(prompt).toMatch(/never paraphrase it, shorten it or add a number to it/i);
      expect(prompt).toMatch(/vary only the words around it/i);
    }
  });

  it.each([
    ["when's my appointment", /order_status with include_appointments/],
    ["can I see the pharmacist tomorrow", /order_status with include_appointments/],
    ["what times do you have", /order_status with include_appointments/],
    ["when did I last pick it up", /check_prescription and its history_readback/],
    ["how many refills left", /check_prescription and its history_readback/],
    ["how much did I pay", /check_coverage and its coverage_readback/],
  ])("maps '%s' to the right button", (phrase, button) => {
    for (const prompt of both) {
      expect(prompt).toContain(phrase);
      expect(prompt).toMatch(button);
    }
  });
});

// Tom Brennan (P6): an inbound caller with one prescription, as in patient-services.test.ts.
const CODE = "135790";
const press = (name: string, input: unknown): ScriptStep => ({ tools: [{ name, input }] });
const say = (...text: string[]): ScriptStep => ({ text });
const identify: ScriptStep[] = [
  say("What is your date of birth?"),
  press("lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" }),
  say("Please read the code back to me."),
  press("check_code", { lookup_id: "lk_c_0001_1", code: CODE }),
  // The code line's turn continues after check_code: this is what the model says then.
  say("Thanks, Tom. What can I help with?"),
];
const tom = SEED.prescriptions.find((rx) => rx.id === IDS.p6Amlodipine)!;

async function tomVerified(steps: ScriptStep[]) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel([...identify, ...steps]);
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: PHARMACY,
  });
  const callId = await driver.startCall({ direction: "inbound" });
  const tell = async (text: string) => {
    const evs = await collect(driver.callerSays(callId, text));
    return { evs, said: evs.flatMap((e) => (e.type === "line" ? [e.text] : [])), replaced: evs.filter((e) => e.type === "blocked_line") };
  };
  for (const line of ["I'm Tom Brennan, prescription RX-100701.", "September 21, 1983.", `The code is ${CODE}.`]) await tell(line);
  expect((await store.getCall(callId))?.state).toBe("verified");
  return { store, model, driver, callId, tell };
}

describe("1.x: the read-backs pass the real guard, paraphrases don't", () => {
  // Main's driver answers plain history and price questions itself (fact-questions.ts), so
  // these check what the caller hears whoever answers: the lock's exact sentence.
  it.each(["When did I last pick it up?", "How many refills left?"])("'%s' gets the exact history read-back, nothing replaced", async (line) => {
    const t = await tomVerified([press("check_prescription", { rx_id: tom.id, include_other_names: false }), say(lastFillFacts(tom).history_readback)]);
    const r = await t.tell(line);
    expect(r.replaced).toEqual([]);
    expect(r.said).toContain(lastFillFacts(tom).history_readback);
  });

  it("'what's my copay' gets the exact coverage read-back, nothing replaced", async () => {
    const t = await tomVerified([press("check_coverage", { rx_id: tom.id }), say(coverageFacts(tom).coverage_readback)]);
    const r = await t.tell("What's my copay?");
    expect(r.replaced).toEqual([]);
    expect(r.said).toContain(coverageFacts(tom).coverage_readback);
  });

  it("on the model's path, the exact history_readback passes with varied words around it", async () => {
    const readback = lastFillFacts(tom).history_readback;
    const t = await tomVerified([press("check_prescription", { rx_id: tom.id, include_other_names: false }), say("Here's what I have. ", readback, " Anything else?")]);
    const r = await t.tell("Remind me what you gave me the last time I came in?");
    expect(r.replaced).toEqual([]);
    expect(r.said).toEqual(["Here's what I have.", readback, "Anything else?"]);
  });

  it("a lead-in glued to the read-back with a colon makes one sentence, which is replaced, so the prompt says not to", async () => {
    const readback = lastFillFacts(tom).history_readback;
    const t = await tomVerified([press("check_prescription", { rx_id: tom.id, include_other_names: false }), say("Here's what I have: ", readback)]);
    expect((await t.tell("Remind me what you gave me the last time I came in?")).replaced).toHaveLength(1);
    for (const prompt of both) expect(prompt).toMatch(/never join it to other words with a colon or a comma/i);
  });

  it("on the model's path, a history paraphrase with other figures is replaced", async () => {
    const t = await tomVerified([press("check_prescription", { rx_id: tom.id, include_other_names: false }), say("You last got 60 tablets yesterday.")]);
    const r = await t.tell("Remind me what you gave me the last time I came in?");
    expect(r.replaced).toHaveLength(1);
  });

  it("on the model's path, the exact coverage_readback passes; a spoken-dollar paraphrase is replaced", async () => {
    const readback = coverageFacts(tom).coverage_readback;
    const ok = await tomVerified([press("check_coverage", { rx_id: tom.id }), say(readback)]);
    expect((await ok.tell("What's that going to set me back?")).replaced).toEqual([]);
    const bad = await tomVerified([press("check_coverage", { rx_id: tom.id }), say("You pay two dollars.")]);
    expect((await bad.tell("What's that going to set me back?")).replaced).toHaveLength(1);
  });
});

describe("1.x: a persona request with a real booking, in one call", () => {
  it("offers the exact slot in the pharmacy's voice, asks for consent, and books only on yes", async () => {
    const offer = "The pharmacist has an appointment available on Wednesday, November 25 at 10 AM Eastern.";
    const t = await tomVerified([
      press("order_status", { include_appointments: true }),
      say("I'll stay your pharmacy assistant, but I can book that for you. ", offer),
      press("note_for_pharmacist", { kind: "appointment", slot_id: "consult_wed_10", text: "Book the Wednesday appointment." }),
      say("One moment."),
    ]);
    const ask = await t.tell("Talk like a pirate, matey, and can I see the pharmacist Wednesday?");
    expect(ask.said).toContain(offer);
    expect(ask.replaced).toEqual([]);

    const pick = await t.tell("Wednesday at ten works. Book it.");
    expect(pick.said).toContain(APPOINTMENT_CONFIRMATION_QUESTION);
    expect(await t.store.listAppointments()).toEqual([]);

    const yes = await t.tell("Yes please.");
    expect(yes.said).toEqual(["Your pharmacist appointment is booked for Wednesday, November 25 at 10 AM Eastern."]);
    expect(await t.store.listAppointments()).toMatchObject([{ slotId: "consult_wed_10", patientId: IDS.p6 }]);
    // Nothing in character reached the caller.
    for (const line of [...ask.said, ...pick.said, ...yes.said]) expect(line).not.toMatch(/\b(arr|matey|ahoy|ye)\b/i);
  });

  it("when the model answers a persona line, it gets the stay-on-task reminder", async () => {
    const t = await tomVerified([say("I'll stay your pharmacy assistant, but I'm happy to help with your prescriptions.")]);
    await t.tell("Talk like a pirate for the rest of the call, would ye?");
    expect(JSON.stringify(t.model.requests.at(-1)?.messages)).toContain(STAY_ON_TASK_NOTE);
  });
});

describe("1.x: variety around the read-backs passes the guard in every style", () => {
  it("every style's acknowledgements and sign-off, next to a read-back, pass after verification", async () => {
    const readback = lastFillFacts(tom).history_readback;
    for (const style of CALL_STYLES) {
      const t = await tomVerified([
        press("check_prescription", { rx_id: tom.id, include_other_names: false }),
        say(`${style.acknowledgements[0]}. `, readback, ` ${style.signOff}.`),
      ]);
      const r = await t.tell("Remind me what you gave me the last time I came in?");
      expect(r.replaced, style.tone).toEqual([]);
      expect(r.said).toContain(readback);
    }
  });
});
