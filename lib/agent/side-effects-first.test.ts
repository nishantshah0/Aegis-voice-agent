// 1.x (Nishant, after the live demo call on main fd87bfb): the side-effect question
// comes before the refill is placed, and is never asked again when the caller already
// said. Live, Sam said "Yes please. Also I've been sleeping badly for about two weeks",
// the agent placed the refill, noted it, and then asked "Since your last refill, have you
// noticed any side effects?" anyway.
//
// The driver holds a refill the model asks for on a verified call until the question is
// answered, then places it through the same lock. Before verification, or for a refill
// the rules would refuse, the press goes straight to the lock as before.

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { SIDE_EFFECT_PASSED_ON, sideEffectQuestionBeforeRefill } from "./lines";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "112358";
const LOOKUP = outboundLookupId("c_0001");
const LABEL = SEED.prescriptions.find((rx) => rx.id === IDS.samConcerta)!.labelText;
const QUESTION = sideEffectQuestionBeforeRefill(LABEL);

const lines = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "line" ? [e.text] : []));
const presses = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "press" ? [e] : []));
const blocked = (evs: AgentEvent[]) => evs.filter((e) => e.type === "blocked_line");
const asked = (evs: AgentEvent[]) => lines(evs).filter((l) => /side effects/.test(l));

async function samOutbound(steps: ScriptStep[]) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel(steps);
  const guard = createSpeechGuard({ store });
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: guard,
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: "Maple Street Pharmacy",
    random: () => 0,
  });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused the call");
  driver.joinCall(started.callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
  await collect(driver.opening(started.callId));
  return { store, control, model, guard, driver, callId: started.callId };
}

const verified: ScriptStep[] = [
  { tools: [{ name: "check_code", input: { lookup_id: LOOKUP, code: CODE, dob: "1990-03-14" } }] },
  { text: ["Thanks, Sam. ", "Your Concerta 36 mg is due, and you pay $4.10. ", "Would you like me to request that refill?"] },
];
const refill = { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] };
const sideEffectNote = (text: string) => ({ tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samConcerta, text, kind: "side_effect" } }] });
const READY = "A pharmacist will check it first, and it should be ready Thursday once it's approved.";

describe("1.x: the side-effect question comes before the refill is placed", () => {
  it("asks right after the yes, and places the refill only on the answer", async () => {
    const t = await samOutbound([...verified, refill, { text: ["Sure."] }, { text: [READY] }]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    const yes = await collect(t.driver.callerSays(t.callId, "Yes please."));

    // Nothing is placed on the yes. The model is told why, and the question is the turn's last line.
    expect(presses(yes)).toEqual([]);
    expect(lines(yes)).toEqual(["Sure.", QUESTION]);
    expect(JSON.stringify(t.model.requests[3].messages.at(-1)?.content)).toContain("Not placed yet");
    expect((await t.store.listRecord(t.callId)).some((e) => e.button === "request_refill")).toBe(false);

    const answer = await collect(t.driver.callerSays(t.callId, "No, nothing."));
    expect(presses(answer).map((p) => p.button)).toEqual(["request_refill"]);
    expect(presses(answer)[0].result).toMatchObject({ ok: true, lane: "quick_check", output: { state: "waiting_for_pharmacist", ready_label: "Thursday" } });
    expect(lines(answer)).toEqual([READY]);
    expect(blocked([...yes, ...answer])).toEqual([]);

    // In the record: the question was spoken before the refill press.
    const record = await t.store.listRecord(t.callId);
    const question = record.findIndex((e) => e.kind === "line_spoken" && (e.input as { text?: string }).text === QUESTION);
    const placed = record.findIndex((e) => e.button === "request_refill");
    expect(question).toBeGreaterThan(-1);
    expect(placed).toBeGreaterThan(question);
    expect(findBrokenLink(await t.store.listRecord())).toBeNull();
  });

  it("a side effect in the answer goes in with the refill: it lands in Review with the note", async () => {
    const t = await samOutbound([
      ...verified,
      refill,
      { text: ["Sure."] },
      sideEffectNote("Trouble sleeping for about two weeks, mild"),
      { text: [`${SIDE_EFFECT_PASSED_ON} `, READY] },
    ]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    await collect(t.driver.callerSays(t.callId, "Yes please."));
    const answer = await collect(t.driver.callerSays(t.callId, "I've been sleeping badly for about two weeks, it's mild."));
    expect(presses(answer).map((p) => p.button)).toEqual(["request_refill", "note_for_pharmacist"]);
    expect(blocked(answer)).toEqual([]);
    const review = await t.store.queue("review");
    expect(review.find((q) => q.kind === "refill" && q.rxId === IDS.samConcerta)?.signals).toContain("side_effect");
    expect(await t.store.queue("quick_check")).toEqual([]);
  });
});

describe("1.x: never re-ask a side effect the caller already volunteered", () => {
  it("note first, then the refill: placed at once, and no question", async () => {
    const t = await samOutbound([
      ...verified,
      // "Yes please. Also I've been sleeping badly for about two weeks, it's mild."
      sideEffectNote("Sleeping badly for about two weeks, mild"),
      refill,
      { text: [`${SIDE_EFFECT_PASSED_ON} `, READY] },
      { text: ["Take care now."] },
    ]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    const yes = await collect(t.driver.callerSays(t.callId, "Yes please. Also I've been sleeping badly for about two weeks, it's mild."));
    expect(presses(yes).map((p) => p.button)).toEqual(["note_for_pharmacist", "request_refill"]);
    expect(presses(yes)[1].result).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist" } });
    expect(asked(yes)).toEqual([]);
    const bye = await collect(t.driver.callerSays(t.callId, "That's all, thanks."));
    expect(asked(bye)).toEqual([]);
    expect((await t.store.queue("review")).some((q) => q.kind === "refill" && q.signals.includes("side_effect"))).toBe(true);
  });

  it("refill first, then the note, in one turn: the held refill goes in at the end of the turn, and no question", async () => {
    const t = await samOutbound([
      ...verified,
      refill,
      sideEffectNote("Sleeping badly for about two weeks, mild"),
      { text: [SIDE_EFFECT_PASSED_ON] },
      { text: [READY] },
    ]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    const yes = await collect(t.driver.callerSays(t.callId, "Yes please. Also I've been sleeping badly for about two weeks, it's mild."));
    expect(presses(yes).map((p) => p.button)).toEqual(["note_for_pharmacist", "request_refill"]);
    expect(asked(yes)).toEqual([]);
    // The model hears the refill is now placed, on the next turn.
    const next = await collect(t.driver.callerSays(t.callId, "Okay."));
    expect(JSON.stringify(t.model.requests.at(-1)?.messages)).toContain("now placed");
    expect(asked(next)).toEqual([]);
  });
});

describe("1.x: one side-effect question, not two (live run side-effects-first)", () => {
  it("when the model asks about side effects itself after the hold, the driver doesn't ask again", async () => {
    // Live: "Before I place it, is there any side effect you've noticed…" then the driver's own question.
    const t = await samOutbound([
      ...verified,
      refill,
      { text: ["Before I place it, have you noticed any side effects since your last refill?"] },
      { text: [READY] },
    ]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    const yes = await collect(t.driver.callerSays(t.callId, "Yes please."));
    expect(asked(yes)).toEqual(["Before I place it, have you noticed any side effects since your last refill?"]);
    expect(presses(yes)).toEqual([]);
    // The next line is still read as the answer, and places the refill.
    const answer = await collect(t.driver.callerSays(t.callId, "No, nothing like that."));
    expect(presses(answer).map((p) => p.button)).toEqual(["request_refill"]);
    expect(JSON.stringify(t.model.requests.at(-1)?.messages)).toContain("answering the side-effect question");
  });

  it("tells the model the phone system asks the question itself", async () => {
    const t = await samOutbound([...verified, refill, { text: ["Sure."] }]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    await collect(t.driver.callerSays(t.callId, "Yes please."));
    const held = JSON.stringify(t.model.requests[3].messages.at(-1)?.content);
    expect(held).toMatch(/asks the side-effect question itself/);
    expect(held).toMatch(/don't ask it yourself/i);
  });
});

describe("1.x: when the refill isn't held", () => {
  it("a refill the rules refuse goes straight to the lock, with no question", async () => {
    // Dev's Adderall is too early (rule 4b): check_prescription says it can't be refilled today.
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => CODE });
    const model = scriptedModel([
      { tools: [{ name: "check_code", input: { lookup_id: "lk_c_0001_1", code: CODE } }] },
      { text: ["Thanks, Dev."] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.p4Adderall } }] },
      { text: ["It can't be refilled yet."] },
    ]);
    const driver = createAgentDriver({ calls: control, press: control.press, guardSentence: createSpeechGuard({ store }), checkCallerLine: createSafetyCheck({ store }), model, pharmacyName: "Maple Street Pharmacy" });
    const callId = await driver.startCall({ direction: "inbound" });
    await control.press(callId, "lookup_patient", { name: "Dev Halvorsen", dob: "2001-05-19", rx_number: "RX-100501" });
    // Verified through the driver, so it sees check_code and its check_prescription (refillable_today false).
    await collect(driver.callerSays(callId, CODE));
    const evs = await collect(driver.callerSays(callId, "Refill my Adderall."));
    expect(presses(evs).map((p) => p.button)).toEqual(["request_refill"]);
    expect(presses(evs)[0].result).toMatchObject({ ok: true, output: { state: "refused" } });
    expect(asked(evs)).toEqual([]);
  });

  it("before verification, the press reaches the lock and is refused there", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store });
    const model = scriptedModel([refill, { text: ["I can help once you're verified."] }]);
    const driver = createAgentDriver({ calls: control, press: control.press, guardSentence: createSpeechGuard({ store }), checkCallerLine: createSafetyCheck({ store }), model, pharmacyName: "Maple Street Pharmacy" });
    const callId = await driver.startCall({ direction: "inbound" });
    const evs = await collect(driver.callerSays(callId, "Refill my Concerta."));
    expect(presses(evs)[0]).toMatchObject({ button: "request_refill", result: { ok: false, error: "not_verified" } });
    expect(asked(evs)).toEqual([]);
  });

  it("the caller said yes and hung up before answering: the refill is placed at hang-up", async () => {
    const t = await samOutbound([...verified, refill, { text: ["Sure."] }]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    await collect(t.driver.callerSays(t.callId, "Yes please."));
    await t.driver.endCall(t.callId);
    expect((await t.store.listRecord(t.callId)).filter((e) => e.button === "request_refill")).toHaveLength(1);
    expect((await t.store.queue("quick_check")).map((q) => q.patientId)).toEqual([IDS.sam]);
  });
});

describe("1.x: the before-the-refill question passes the real guard", () => {
  it("on a verified call, before anything is placed", async () => {
    const t = await samOutbound([]);
    await t.control.press(t.callId, "check_code", { lookup_id: LOOKUP, code: CODE, dob: "1990-03-14" });
    for (const label of [LABEL, "TEST 5 MG TABLET. Side effects may include: headache, nausea."]) {
      const q = sideEffectQuestionBeforeRefill(label);
      expect(await t.guard(t.callId, q), q).toMatchObject({ blocked: false, speak: q });
    }
    expect(sideEffectQuestionBeforeRefill("TEST. Side effects may include: headache, nausea.")).toContain("like headache, nausea");
  });
});
