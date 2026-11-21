// 1.3: the outbound call and the side-effect question, on the real lock with a
// scripted model. "Done when": Sam's outbound call ends in the Review lane with
// his side-effect note.
import { describe, expect, it } from "vitest";
import type { AgentEvent, StreamEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { EMERGENCY_SCRIPT, createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { SIDE_EFFECT_PASSED_ON, inboundGreeting, outboundOpener, sideEffectQuestion } from "./lines";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "112358";
const PHARMACY = "Maple Street Pharmacy";
const LABEL = SEED.prescriptions.find((rx) => rx.id === IDS.samConcerta)!.labelText;

const lines = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "line" ? [e.text] : []));
const presses = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "press" ? [e] : []));
const blocked = (evs: AgentEvent[]) => evs.filter((e) => e.type === "blocked_line");

/** The daily check starts the call on the control layer; the driver joins it when Sam answers. */
async function ring(steps: ScriptStep[]) {
  const store = createMemoryStore(SEED);
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);
  const control = createControl({ store, emit, makeCode: () => CODE });
  const model = scriptedModel(steps);
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model,
    pharmacyName: PHARMACY,
    emit,
  });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error(`rule 7 refused: ${started.ruleIds}`);
  const { callId, lookupId } = started;
  driver.joinCall(callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
  return { store, events, control, model, driver, callId, lookupId };
}

const verifyAndOffer = (lookupId: string): ScriptStep[] => [
  // "It's 112358."
  { tools: [{ name: "check_code", input: { lookup_id: lookupId, code: CODE } }] },
  { text: ["Thanks, Sam. ", "It's a controlled medication, so a pharmacist has to approve your Concerta. ", "Want me to send it to them now?"] },
  // "Yes please."
  { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
  { text: ["Done. ", "A pharmacist will check it first, and I'll confirm once it's approved."] },
];

describe("1.3: the outbound opening", () => {
  it("says only the opener, then sends the code through send_code", async () => {
    const { events, model, driver, callId } = await ring([]);
    const evs = await collect(driver.opening(callId));
    expect(lines(evs)).toEqual([outboundOpener(PHARMACY, "Sam Rivera")]);
    expect(blocked(evs)).toHaveLength(0);
    expect(presses(evs).map((p) => [p.button, p.result.ok])).toEqual([["send_code", true]]);
    expect(events.some((e) => e.type === "phone" && e.kind === "code" && e.text.includes(CODE))).toBe(true);
    expect(model.requests).toHaveLength(0);
  });

  it("tells the model the opener was said and the code was sent", async () => {
    const { model, driver, callId, lookupId } = await ring([{ text: ["Could you read me the code?"] }]);
    await collect(driver.opening(callId));
    await collect(driver.callerSays(callId, "Hello?"));
    const system = model.requests[0].system;
    expect(system).toContain(`You have already said to the caller: "${outboundOpener(PHARMACY, "Sam Rivera")}"`);
    expect(system).toContain(`the lookup id is ${lookupId}`);
    expect(system).toContain("The code has been sent");
  });

  it("greets an inbound caller with the fixed greeting and presses nothing", async () => {
    const store = createMemoryStore(SEED);
    const control = createControl({ store });
    const driver = createAgentDriver({
      calls: control,
      press: control.press,
      guardSentence: createSpeechGuard({ store }),
      checkCallerLine: createSafetyCheck({ store }),
      model: scriptedModel([]),
      pharmacyName: PHARMACY,
    });
    const callId = await driver.startCall({ direction: "inbound" });
    const evs = await collect(driver.opening(callId));
    expect(lines(evs)).toEqual([inboundGreeting(PHARMACY)]);
    expect(presses(evs)).toHaveLength(0);
  });
});

describe("1.3: Sam's outbound call ends in Review with his side-effect note", () => {
  async function samsCall() {
    const t = await ring([]);
    const steps: ScriptStep[] = [
      ...verifyAndOffer(t.lookupId),
      // "I've had some mild headaches in the afternoon."
      { tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samConcerta, text: "Mild headaches in the afternoon since the last refill", kind: "side_effect" } }] },
      { text: [SIDE_EFFECT_PASSED_ON] },
    ];
    const model = scriptedModel(steps);
    const driver = createAgentDriver({
      calls: t.control,
      press: t.control.press,
      guardSentence: createSpeechGuard({ store: t.store, emit: (e) => t.events.push(e) }),
      checkCallerLine: createSafetyCheck({ store: t.store }),
      model,
      pharmacyName: PHARMACY,
    });
    driver.joinCall(t.callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
    const opening = await collect(driver.opening(t.callId));
    const code = await collect(driver.callerSays(t.callId, `It's ${CODE}.`));
    const yes = await collect(driver.callerSays(t.callId, "Yes please."));
    const answer = await collect(driver.callerSays(t.callId, "I've had some mild headaches in the afternoon."));
    await driver.endCall(t.callId);
    return { ...t, model, opening, code, yes, answer };
  }

  it("verifies, sends the refill to a pharmacist, asks the label's side-effect question, and notes the answer", async () => {
    const { store, model, opening, code, yes, answer } = await samsCall();
    expect(model.remaining()).toBe(0);
    for (const turn of [opening, code, yes, answer]) expect(blocked(turn)).toEqual([]);

    expect(presses(code)[0].result).toMatchObject({ ok: true, output: { verified: true } });
    expect(presses(yes).map((p) => p.button)).toEqual(["request_refill", "read_label"]);
    expect(presses(yes)[0].result).toMatchObject({ ok: true, output: { state: "waiting_for_pharmacist" } });
    // The question is built from the label the read_label press returned.
    expect(lines(yes).at(-1)).toBe(sideEffectQuestion(LABEL));

    expect(presses(answer).map((p) => p.button)).toEqual(["note_for_pharmacist"]);
    expect(lines(answer)).toEqual([SIDE_EFFECT_PASSED_ON]);

    const review = await store.queue("review");
    const note = review.find((q) => q.signals.includes("side_effect"));
    expect(note).toMatchObject({ patientId: IDS.sam, rxId: IDS.samConcerta });
    expect(note?.notes[0]).toMatchObject({ kind: "side_effect", text: "Mild headaches in the afternoon since the last refill" });
    expect(findBrokenLink(await store.listRecord())).toBeNull();
  });

  it("tells the model the caller is answering the side-effect question, once", async () => {
    const { model } = await samsCall();
    const answerTurn = model.requests[4].messages;
    expect(answerTurn.at(-2)).toMatchObject({ role: "user", content: "I've had some mild headaches in the afternoon." });
    expect(answerTurn.at(-1)?.role).toBe("system");
    expect(String(answerTurn.at(-1)?.content)).toContain(`answering the side-effect question about rx_id ${IDS.samConcerta}`);
    // The question is in the history as the agent's own words.
    expect(answerTurn.some((m) => m.role === "assistant" && m.content === sideEffectQuestion(LABEL))).toBe(true);
    // The note isn't repeated on the next turn.
    expect(model.requests[5].messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("asks the side-effect question only once per prescription", async () => {
    const t = await ring([
      ...verifyAndOffer("out_c_0001"),
      { text: ["Is there anything else I can help with?"] },
      { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
      { text: ["That one is already with the pharmacist."] },
    ]);
    await collect(t.driver.opening(t.callId));
    await collect(t.driver.callerSays(t.callId, `It's ${CODE}.`));
    const first = await collect(t.driver.callerSays(t.callId, "Yes please."));
    await collect(t.driver.callerSays(t.callId, "No side effects."));
    const again = await collect(t.driver.callerSays(t.callId, "Can you order the Concerta again?"));
    expect(presses(first).map((p) => p.button)).toContain("read_label");
    expect(presses(again).map((p) => p.button)).not.toContain("read_label");
  });
});

describe("1.3: a serious answer goes to the safety check, not the model", () => {
  it("gives the emergency script when the caller mentions chest pain", async () => {
    const t = await ring(verifyAndOffer("out_c_0001"));
    await collect(t.driver.opening(t.callId));
    await collect(t.driver.callerSays(t.callId, `It's ${CODE}.`));
    await collect(t.driver.callerSays(t.callId, "Yes please."));
    const before = t.model.requests.length;
    const evs = await collect(t.driver.callerSays(t.callId, "Actually I've had chest pain since yesterday."));
    expect(evs[0]).toMatchObject({ type: "safety", result: { action: "emergency" } });
    expect(lines(evs)).toEqual([EMERGENCY_SCRIPT]);
    expect(t.model.requests.length).toBe(before);
  });
});
