// What the model is told after the guard replaces one of its sentences
// (lib/agent/driver.ts:135).
//
// ROLE-0's REQUEST at 20:59, from demo pass 14 on live Haiku: S4 replaced "Your
// code and date of birth are confirmed." and on its next turn the agent opened
// with "I'm sorry, I should correct what I said a moment ago." The caller never
// heard the original, so an apology invents a mistake for them and tells a judge
// something went wrong.
//
// The note has to say what to do with the information, not just report it.

import { describe, expect, it } from "vitest";

import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

import { createAgentDriver } from "./driver";
import { scriptedModel } from "./testing/scripted-model";

const CODE = "135791";
/** check_code verifies only with the date of birth too, so S1 would block otherwise. */
const SAM_DOB = SEED.patients.find((p) => p.id === IDS.sam)!.dob;
/** S4 blocks this on a call whose refill is still waiting on a pharmacist. */
const FALSE_PROMISE = "Your Concerta refill is approved.";

async function callWithAReplacedLine() {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel([{ text: ["Of course."] }]);
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: "Maple Street Pharmacy",
  });

  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused the call");
  const { callId, lookupId } = started;
  driver.joinCall(callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE, dob: SAM_DOB });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });

  const events = [];
  for await (const e of driver.speakLine(callId, FALSE_PROMISE)) events.push(e);
  return { driver, model, callId, events };
}

describe("after the guard replaces a line", () => {
  it("replaces a false promise, so there is something to tell the model about", async () => {
    const { events } = await callWithAReplacedLine();
    expect(events.some((e) => e.type === "blocked_line" && e.rule === "S4")).toBe(true);
  });

  it("tells the model to carry on from what the caller heard, and not to apologise", async () => {
    const { driver, model, callId } = await callWithAReplacedLine();

    // The note rides along with the next caller line.
    for await (const _ of driver.callerSays(callId, "Sorry, what was that?")) void _;

    const seen = model.requests.at(-1)!;
    const note = seen.messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join(" ");

    expect(note).toContain("the caller heard");
    // The point of the fix: the note must not read as "you made a mistake".
    expect(note).toMatch(/carry on/i);
    expect(note).toMatch(/do not mention|don't mention/i);
    expect(note).toMatch(/apolog/i);
  });
});
