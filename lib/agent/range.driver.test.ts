// 1.x (Trail #75): the driver side of the agent's wider range, on the real lock
// with a scripted model.
//   * Each call gets its own voice (a style in the prompt, varied fixed lines).
//   * The delivery windows are in the call note, so set_delivery has a slot id.
//   * Right after verification the driver checks the prescription and its cost
//     itself (real presses, in the record), so the model can answer and read back
//     in one step instead of three (audit fix 1), and the price it reads back is the
//     coverage figure S4 checks against (audit fix 2).
//   * The flows the prompt teaches (several requests in one turn, a renewal, a
//     label question, order status and a delivery change) pass the real guard.

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createAgentDriver, type DriverStartOpts } from "./driver";
import { CODE_SENT, HANDOVER_LINES, STILL_THERE, pickLine } from "./lines";
import { CALL_STYLES } from "./prompt";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "112358";
const PHARMACY = "Maple Street Pharmacy";
/** Every test builds a fresh store, so the outbound call is always c_0001. */
const LOOKUP = outboundLookupId("c_0001");

const lines = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "line" ? [e.text] : []));
const presses = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "press" ? [e] : []));
const blocked = (evs: AgentEvent[]) => evs.filter((e) => e.type === "blocked_line");

function setup(steps: ScriptStep[], extra: { random?: () => number; deliverySlots?: { id: string; label: string }[]; patientPhone?: boolean } = {}) {
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
    pharmacyName: PHARMACY,
    ...extra,
  });
  return { store, control, model, driver, guard };
}

/** Sam's outbound call, rung by the daily check and joined by the driver. */
async function samOutbound(steps: ScriptStep[], extra: Parameters<typeof setup>[1] = {}) {
  const t = setup(steps, extra);
  const started = await t.control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused the call");
  const opts: DriverStartOpts = { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" };
  t.driver.joinCall(started.callId, opts);
  await collect(t.driver.opening(started.callId));
  return { ...t, callId: started.callId, lookupId: started.lookupId };
}

const verifySam = (lookupId: string): ScriptStep => ({
  tools: [{ name: "check_code", input: { lookup_id: lookupId, code: CODE, dob: "1990-03-14" } }],
});

/** An inbound call verified through the control layer (not the driver), for flows after verification. */
async function verifiedInbound(name: string, dob: string, rxNumber: string, steps: ScriptStep[]) {
  const t = setup(steps);
  const callId = await t.driver.startCall({ direction: "inbound" });
  const looked = await t.control.press(callId, "lookup_patient", { name, dob, rx_number: rxNumber });
  if (!looked.ok) throw new Error("lookup failed");
  const checked = await t.control.press(callId, "check_code", { lookup_id: looked.output.lookup_id, code: CODE });
  if (!checked.ok || !("verified" in checked.output) || !checked.output.verified) throw new Error("not verified");
  return { ...t, callId };
}

describe("1.x: every call gets its own voice", () => {
  it("puts the call's style in the prompt, picked from the random source, and keeps it for the call", async () => {
    const first = await samOutbound([{ text: ["Hello."] }, { text: ["Sure."] }], { random: () => 0 });
    await collect(first.driver.callerSays(first.callId, "Hi."));
    await collect(first.driver.callerSays(first.callId, "Okay."));
    expect(first.model.requests[0].system).toContain(CALL_STYLES[0].tone);
    expect(first.model.requests[1].system).toBe(first.model.requests[0].system);

    const last = await samOutbound([{ text: ["Hello."] }], { random: () => 0.999 });
    await collect(last.driver.callerSays(last.callId, "Hi."));
    expect(last.model.requests[0].system).toContain(CALL_STYLES.at(-1)!.tone);
    expect(last.model.requests[0].system).not.toBe(first.model.requests[0].system);
  });

  it("keeps the check-in line fixed, whatever the call's voice", async () => {
    // The real phone line (app/api/voice-gather.test.ts, Trail #70) plays this exact line.
    for (const r of [0, 0.999]) {
      const t = setup([], { random: () => r });
      const callId = await t.driver.startCall({ direction: "inbound" });
      expect(lines(await collect(t.driver.checkIn(callId)))).toEqual([STILL_THERE]);
    }
  });

  it("picks a line from the random number it is given", () => {
    expect(pickLine(["a", "b", "c"], () => 0)).toBe("a");
    expect(pickLine(["a", "b", "c"], () => 0.5)).toBe("b");
    expect(pickLine(["a", "b", "c"], () => 0.9999)).toBe("c");
  });

  it("every check-in and handover line passes the real guard, before and after verification", async () => {
    const t = await samOutbound([]);
    for (const line of [STILL_THERE, ...HANDOVER_LINES]) {
      expect(await t.guard(t.callId, line), line).toMatchObject({ blocked: false, speak: line });
    }
    await t.control.press(t.callId, "check_code", { lookup_id: t.lookupId, code: CODE, dob: "1990-03-14" });
    for (const line of [STILL_THERE, ...HANDOVER_LINES]) {
      expect(await t.guard(t.callId, line), line).toMatchObject({ blocked: false, speak: line });
    }
  });

  it("hands over with one of the fixed handover lines when the model fails", async () => {
    const t = await samOutbound([], { random: () => 0.999 });
    const evs = await collect(t.driver.callerSays(t.callId, "Hello?"));
    expect(presses(evs).map((p) => p.button)).toEqual(["escalate"]);
    expect(lines(evs)).toEqual([HANDOVER_LINES.at(-1)]);
  });
});

describe("1.x: the delivery windows are in the call note", () => {
  it("lists every slot id with its label, and pickup", async () => {
    const t = await samOutbound([{ text: ["Hello."] }]);
    await collect(t.driver.callerSays(t.callId, "Hi."));
    const system = t.model.requests[0].system;
    for (const slot of SEED.slots) {
      expect(system).toContain(slot.id);
      expect(system).toContain(slot.label);
    }
    expect(system).toMatch(/"pickup"/);
  });

  it("uses the slots it is given, on inbound calls too", async () => {
    const t = setup([{ text: ["Hello."] }], { deliverySlots: [{ id: "slot_x", label: "Friday 2 to 4" }] });
    const callId = await t.driver.startCall({ direction: "inbound" });
    await collect(t.driver.callerSays(callId, "Hi."));
    expect(t.model.requests[0].system).toContain("slot_x");
    expect(t.model.requests[0].system).toContain("Friday 2 to 4");
    expect(t.model.requests[0].system).not.toContain("slot_wed_pm");
  });
});

describe("1.x: after verification the driver checks the prescription and its cost (audit fixes 1 and 2)", () => {
  it("outbound: presses check_prescription and check_coverage for the call's prescription, and the model sees both", async () => {
    const t2 = await samOutbound([
      verifySam(LOOKUP),
      { text: ["Thanks, Sam. ", "Your plan pays $41.20, and you pay $4.10. ", "Want me to send the refill to the pharmacist?"] },
    ]);
    const evs = await collect(t2.driver.callerSays(t2.callId, `It's ${CODE}, and I was born March 14, 1990.`));

    expect(presses(evs).map((p) => [p.button, (p.input as { rx_id?: string }).rx_id])).toEqual([
      ["check_code", undefined],
      ["check_prescription", IDS.samConcerta],
      ["check_coverage", IDS.samConcerta],
      // Live run range-2: check_prescription has no strength, so Haiku guessed "18 mg" (S3 caught it).
      // The label has it.
      ["read_label", IDS.samConcerta],
    ]);
    // One model step after the code, not three: the check_code result carries both.
    expect(t2.model.requests).toHaveLength(2);
    const toolResult = JSON.stringify(t2.model.requests[1].messages.at(-1)?.content);
    expect(toolResult).toContain("already_checked");
    expect(toolResult).toContain("refills_left");
    expect(toolResult).toContain("$4.10");
    expect(toolResult).toContain("CONCERTA 36 MG TABLET");
    // The honest read-back is the coverage figure, so nothing is replaced.
    expect(blocked(evs)).toEqual([]);
    expect(lines(evs)).toContain("Your plan pays $41.20, and you pay $4.10.");
    // Every press is in the record, linked as usual.
    const buttons = (await t2.store.listRecord(t2.callId)).filter((e) => e.kind === "button").map((e) => e.button);
    expect(buttons).toEqual(["send_code", "check_code", "check_prescription", "check_coverage", "read_label"]);
    expect(findBrokenLink(await t2.store.listRecord())).toBeNull();
  });

  it("inbound: checks every one of the verified patient's prescriptions", async () => {
    const t = setup([
      { tools: [{ name: "lookup_patient", input: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" } }] },
      { text: [CODE_SENT] },
      { tools: [{ name: "check_code", input: { lookup_id: "lk_c_0001_1", code: CODE } }] },
      { text: ["Thanks, Sam. ", "What can I help with?"] },
    ]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    await collect(t.driver.callerSays(callId, "Sam Rivera, March 14 1990, RX-100201."));
    const evs = await collect(t.driver.callerSays(callId, CODE));
    const pressed = presses(evs).map((p) => `${p.button}:${(p.input as { rx_id?: string }).rx_id ?? ""}`);
    expect(pressed).toEqual([
      "check_code:",
      `check_prescription:${IDS.samConcerta}`,
      `check_coverage:${IDS.samConcerta}`,
      `read_label:${IDS.samConcerta}`,
      `check_prescription:${IDS.samMetformin}`,
      `check_coverage:${IDS.samMetformin}`,
      `read_label:${IDS.samMetformin}`,
    ]);
    expect(blocked(evs)).toEqual([]);
  });

  it("checks nothing extra when the code is wrong", async () => {
    const t2 = await samOutbound([
      { tools: [{ name: "check_code", input: { lookup_id: LOOKUP, code: "000000", dob: "1990-03-14" } }] },
      { text: ["That code didn't match. ", "Could you read it again?"] },
    ]);
    const evs = await collect(t2.driver.callerSays(t2.callId, "000000, March 14 1990."));
    expect(presses(evs).map((p) => p.button)).toEqual(["check_code"]);
    expect(JSON.stringify(t2.model.requests[1].messages.at(-1)?.content)).not.toContain("already_checked");
  });
});

describe("1.x: the flows the prompt teaches pass the real guard", () => {
  it("several requests in one turn: copay, then the side-effect question, then the refill and pickup", async () => {
    const order = "o_c_0001_rx_sam_metformin";
    const t2 = await samOutbound([
      verifySam(LOOKUP),
      { text: ["Thanks, Sam. ", "What can I help with?"] },
      // "Refill my metformin, what's my copay on it, and can I pick it up Wednesday afternoon?"
      { tools: [{ name: "check_coverage", input: { rx_id: IDS.samMetformin } }] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.samMetformin } }] },
      { text: ["You pay $2.00 for your Metformin."] },
      // "No side effects." The driver places the refill; the model books the pickup it asked for.
      { tools: [{ name: "set_delivery", input: { order_id: order, slot_id: "slot_wed_pm", address_id: "pickup" } }] },
      { text: ["A pharmacist will check the refill first. ", "Pickup is booked for Wednesday 1 to 5."] },
    ]);
    await collect(t2.driver.callerSays(t2.callId, `${CODE}, March 14 1990.`));
    const ask = await collect(t2.driver.callerSays(t2.callId, "Refill my metformin, what's my copay on it, and can I pick it up Wednesday afternoon?"));
    // The refill is held: the copay, then the question (from the label, read for it), and nothing placed yet.
    expect(presses(ask).map((p) => p.button)).toEqual(["check_coverage", "read_label"]);
    const said = lines(ask);
    expect(said[0]).toBe("You pay $2.00 for your Metformin.");
    expect(said[1]).toMatch(/^Before I put it in: .*side effects/);
    expect(said).toHaveLength(2);

    const evs = await collect(t2.driver.callerSays(t2.callId, "No side effects."));
    expect(presses(evs).map((p) => p.button)).toEqual(["request_refill", "set_delivery"]);
    // Metformin is 60% through its supply, so a pharmacist checks it first (rule 3).
    expect(presses(evs)[0].result).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist", order_id: order } });
    expect(presses(evs)[1].result).toMatchObject({ ok: true, output: { ok: true } });
    expect(blocked([...ask, ...evs])).toEqual([]);
    expect(lines(evs)).toEqual(["A pharmacist will check the refill first.", "Pickup is booked for Wednesday 1 to 5."]);
  });

  it("after the side-effect answer, the model is told to offer delivery or pickup if it isn't settled", async () => {
    const t2 = await samOutbound([
      verifySam(LOOKUP),
      { text: ["Thanks, Sam. ", "Want me to send the refill to the pharmacist?"] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["A pharmacist will check it first, and I'll confirm once it's approved."] },
      // Not "delivered" or "picked up": S4 hears those as done-words before anything is booked.
      { text: ["Good to hear. ", "Would you like delivery, or would you rather pick it up?"] },
    ]);
    await collect(t2.driver.callerSays(t2.callId, `${CODE}, March 14 1990.`));
    await collect(t2.driver.callerSays(t2.callId, "Yes please."));
    const evs = await collect(t2.driver.callerSays(t2.callId, "No, nothing."));
    expect(blocked(evs)).toEqual([]);
    const seen = JSON.stringify(t2.model.requests.at(-1)?.messages.slice(-2));
    expect(seen).toMatch(/Would you like delivery, or would you rather pick it up\?/);
  });

  it("no refills left: the refill is refused and a renewal is requested", async () => {
    const t = await verifiedInbound("Maria Okonkwo", "1962-11-30", "RX-100401", [
      { tools: [{ name: "request_refill", input: { rx_id: IDS.p3Lisinopril } }] },
      { text: ["That prescription has expired, so it can't be refilled. ", "Would you like me to ask your prescriber for a renewal?"] },
      { tools: [{ name: "request_renewal", input: { rx_id: IDS.p3Lisinopril } }] },
      { text: ["I've requested a renewal from your prescriber. ", "Is there anything else I can help with?"] },
    ]);
    const first = await collect(t.driver.callerSays(t.callId, "I need a refill of my lisinopril."));
    expect(presses(first)[0].result).toMatchObject({ ok: true, output: { state: "refused" } });
    const second = await collect(t.driver.callerSays(t.callId, "Yes please."));
    expect(presses(second)[0].result).toMatchObject({ ok: true, output: { state: "requested" } });
    expect(blocked([...first, ...second])).toEqual([]);
    expect(lines(second)).toContain("I've requested a renewal from your prescriber.");
  });

  it("a label question the label answers, and one it doesn't, passed to the pharmacist", async () => {
    const t = await verifiedInbound("Sam Rivera", "1990-03-14", "RX-100202", [
      { tools: [{ name: "read_label", input: { rx_id: IDS.samMetformin } }] },
      { text: ["The label says take 1 tablet by mouth twice a day with meals. ", "It doesn't say anything about alcohol. ", "Would you like me to ask the pharmacist?"] },
      { tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samMetformin, text: "Is it okay to drink alcohol with this?", kind: "question" } }] },
      { text: ["I've passed your question to the pharmacist. ", "Anything else?"] },
    ]);
    const first = await collect(t.driver.callerSays(t.callId, "Do I take the metformin with food, and can I have a beer with it?"));
    const second = await collect(t.driver.callerSays(t.callId, "Yes, ask them."));
    expect(blocked([...first, ...second])).toEqual([]);
    expect(lines(first)[0]).toBe("The label says take 1 tablet by mouth twice a day with meals.");
    expect(presses(second)[0].result.ok).toBe(true);
  });

  it("after a refill, the ready day from ready_label passes the real guard", async () => {
    const t2 = await samOutbound([
      verifySam(LOOKUP),
      { text: ["Thanks, Sam. ", "Want me to send the refill to the pharmacist?"] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["Sure."] },
      { text: ["A pharmacist will check it first, and it should be ready Thursday once it's approved."] },
    ]);
    await collect(t2.driver.callerSays(t2.callId, `${CODE}, March 14 1990.`));
    await collect(t2.driver.callerSays(t2.callId, "Yes please."));
    const evs = await collect(t2.driver.callerSays(t2.callId, "No side effects."));
    expect(presses(evs)[0].result).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist", ready_label: "Thursday" } });
    expect(blocked(evs)).toEqual([]);
    expect(lines(evs)[0]).toBe("A pharmacist will check it first, and it should be ready Thursday once it's approved.");
  });

  it("on a status check, the ready day from order_status passes the real guard", async () => {
    const t = await verifiedInbound("Lena Moreau", "1994-12-03", "RX-100801", [
      { tools: [{ name: "order_status", input: {} }] },
      { text: ["Your Sertraline order is queued. ", "It should be ready Wednesday once it's approved."] },
    ]);
    const evs = await collect(t.driver.callerSays(t.callId, "When will my order be ready?"));
    // Lena's order went in a day before the demo clock, so its day is Wednesday, not Thursday.
    expect(presses(evs)[0].result).toMatchObject({ ok: true, output: { orders: [{ order_id: IDS.p7Order, ready_label: "Wednesday" }] } });
    expect(blocked(evs)).toEqual([]);
    expect(lines(evs)).toEqual(["Your Sertraline order is queued.", "It should be ready Wednesday once it's approved."]);
    // Only the day the button gave: any other is replaced.
    expect(await t.guard(t.callId, "It should be ready Thursday once it's approved.")).toMatchObject({ blocked: true, rule: "S4" });
  });

  it("order status, then moving the delivery to a window from the call note", async () => {
    const t = await verifiedInbound("Lena Moreau", "1994-12-03", "RX-100801", [
      { tools: [{ name: "order_status", input: {} }] },
      { text: ["Your Sertraline order is queued. ", "It hasn't been booked for delivery yet. ", "Would you like to set a time?"] },
      { tools: [{ name: "set_delivery", input: { order_id: IDS.p7Order, slot_id: "slot_thu_am", address_id: "pickup" } }] },
      { text: ["Pickup is booked for Thursday 9 to 12."] },
    ]);
    const first = await collect(t.driver.callerSays(t.callId, "Where's my order at?"));
    expect(presses(first)[0].result).toMatchObject({ ok: true, output: { orders: [{ order_id: IDS.p7Order, status: "queued" }] } });
    const second = await collect(t.driver.callerSays(t.callId, "Thursday morning pickup please."));
    expect(blocked([...first, ...second])).toEqual([]);
    expect(lines(second)).toEqual(["Pickup is booked for Thursday 9 to 12."]);
  });
});

describe("1.x: phone behaviour the voice line relies on stays the same", () => {
  it("opening, speakLine and checkIn still go through the guard and into the history", async () => {
    const t = await samOutbound([{ text: ["Yes, I'm here."] }]);
    await collect(t.driver.checkIn(t.callId));
    const said = await collect(t.driver.speakLine(t.callId, "One moment."));
    expect(lines(said)).toEqual(["One moment."]);
    await collect(t.driver.callerSays(t.callId, "Sorry, I'm back."));
    const seen = JSON.stringify(t.model.requests[0]);
    expect(seen).toContain(STILL_THERE);
    expect(seen).toContain(outboundLookupId(t.callId));
  });
});

describe("verified readback without a model turn", () => {
  it("answers a two-part question with fresh, prescription-scoped records and no model-generated numbers", async () => {
    const t = await samOutbound([verifySam(LOOKUP), { text: ["How can I help?"] }]);
    await collect(t.driver.callerSays(t.callId, `${CODE}, March 14 1990.`));
    const turns = t.model.requests.length;
    const events = await collect(t.driver.callerSays(t.callId, "When did I last fill Metformin and what is my copay for a week?"));
    expect(t.model.requests).toHaveLength(turns);
    expect(presses(events).map(p => p.input)).toEqual([
      { rx_id: IDS.samMetformin, include_other_names: false }, { rx_id: IDS.samMetformin, days_supply: 7 },
    ]);
    expect(lines(events)).toEqual([expect.stringContaining("180 tablets for a 90-day supply"), expect.stringContaining("don't have an insurance quote for a 7-day")]);
    expect(blocked(events)).toEqual([]);
  });
});

describe("patient phone when the conversation provider is unavailable", () => {
  it("handles greetings locally, keeps slang private, and retrieves the verified caller's real insurance quote", async () => {
    // No scripted response: the model throws on the first non-greeting turn.
    const t = setup([], { patientPhone: true });
    const callId = await t.driver.startCall({ direction: "inbound" });
    const say = (text: string) => collect(t.driver.callerSays(callId, text));
    await collect(t.driver.opening(callId));
    for (const greeting of ["Yo!", "Hey there!", "Good evening."]) {
      const events = await say(greeting);
      expect(lines(events)).toEqual([expect.stringMatching(/price.*appointment/i)]);
      expect(presses(events)).toHaveLength(0);
    }
    expect(t.model.requests).toHaveLength(0);
    const slang = await say("What's good?");
    expect(lines(slang)).toEqual([expect.stringMatching(/temporarily unavailable/i)]);
    expect(presses(slang)).toHaveLength(0);
    expect(t.model.requests).toHaveLength(1);

    const ask = await say("Can I get my insurance price?");
    expect(lines(ask)).toEqual([expect.stringMatching(/prescription number/i)]);
    expect(presses(ask)).toHaveLength(0);
    const lookup = await say("Tom Brennan, 1983-09-21, RX-100701");
    expect(presses(lookup).map(p => p.button)).toEqual(["lookup_patient"]);
    const wrong = await say("The code is 000000.");
    expect(lines(wrong)).toEqual([expect.stringContaining("couldn't verify")]);
    expect((await t.store.getCall(callId))?.lockedPatientId).toBeUndefined();
    const verified = await say("The code is 1 1 2 3 5 8.");
    expect(presses(verified).map(p => p.button)).toEqual(["check_code"]);
    expect((await t.store.getCall(callId))?.lockedPatientId).toBe(IDS.p6);
    const quote = await say("What's my copay for a week?");
    expect(presses(quote).map(p => p.button)).toEqual(["check_coverage"]);
    expect(lines(quote)).toEqual([expect.stringContaining("your plan pays $3.25 and your share is $1.25")]);
    expect(t.model.requests).toHaveLength(1);
    expect(await t.store.listOrders(IDS.p6)).toHaveLength(0);
  });
});
