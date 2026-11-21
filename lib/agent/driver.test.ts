import { describe, expect, it } from "vitest";
import type { AgentEvent, StreamEvent } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard, HANDOVER_SCRIPT } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";
import { createAgentDriver, STUCK_REASON } from "./driver";
import { outboundOpener } from "./lines";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "112358";
const PHARMACY = "Maple Street Pharmacy";

/** The real lock (store, control, guard, safety check) with a scripted model. */
function setup(steps: ScriptStep[], maxSteps?: number) {
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
    maxSteps,
  });
  return { store, events, control, model, driver };
}

const lines = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "line" ? [e.text] : []));
const presses = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "press" ? [e] : []));

describe("1.2: Sam's typed outbound call through the real lock", () => {
  const lookup = outboundLookupId("c_0001");
  const script: ScriptStep[] = [
    // "Yes, this is Sam."
    { text: ["One moment", "."], tools: [{ name: "send_code", input: { lookup_id: lookup } }] },
    { text: ["I've sent a code to the phone on file. ", "Could you read it back to me?"] },
    // "It's 112358."
    { tools: [{ name: "check_code", input: { lookup_id: lookup, code: CODE } }] },
    { text: ["Thanks, Sam. ", "Would you like me to order a refill of your Concerta?"] },
    // "Yes please."
    { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
    { text: ["Your Concerta refill is approved. ", "Is there anything else?"] },
  ];

  async function samsCall() {
    const t = setup(script);
    const callId = await t.driver.startCall({ direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    const opener = await collect(t.driver.speakLine(callId, outboundOpener(PHARMACY, "Sam")));
    const turn1 = await collect(t.driver.callerSays(callId, "Yes, this is Sam."));
    const turn2 = await collect(t.driver.callerSays(callId, `It's ${CODE}.`));
    const turn3 = await collect(t.driver.callerSays(callId, "Yes please."));
    await t.driver.endCall(callId);
    return { ...t, callId, opener, turn1, turn2, turn3 };
  }

  it("verifies Sam, sends his refill to Quick check, and guards every sentence", async () => {
    const { store, events, control, model, callId, opener, turn1, turn2, turn3 } = await samsCall();
    expect(callId).toBe("c_0001");
    expect(model.remaining()).toBe(0);

    expect(lines(opener)).toEqual([outboundOpener(PHARMACY, "Sam")]);
    expect(lines(turn1)).toEqual(["One moment.", "I've sent a code to the phone on file.", "Could you read it back to me?"]);
    expect(presses(turn1)[0].result.ok).toBe(true);
    // The code goes to the phone on file, never onto the stream: the stream only says one was sent.
    expect(events.some((e) => e.type === "phone" && e.kind === "code")).toBe(true);
    expect(events.some((e) => e.type === "phone" && e.text.includes(CODE))).toBe(false);
    expect(await control.codeFor(callId)).toBe(CODE);

    expect(presses(turn2)[0].result).toMatchObject({ ok: true, output: { verified: true, patient_first_name: "Sam" } });
    expect(lines(turn2)).toEqual(["Thanks, Sam.", "Would you like me to order a refill of your Concerta?"]);

    const refill = presses(turn3)[0];
    expect(refill.result).toMatchObject({ ok: true, lane: "quick_check", ruleIds: ["4"], output: { state: "waiting_for_pharmacist" } });
    // S4: "approved" isn't true yet, so the caller hears the guard's line instead.
    const blocked = turn3.find((e) => e.type === "blocked_line");
    expect(blocked).toMatchObject({ rule: "S4", original: "Your Concerta refill is approved." });
    expect(lines(turn3)).not.toContain("Your Concerta refill is approved.");

    // Every line the agent spoke is in the record, through the guard.
    const record = await store.listRecord(callId);
    const spokenOrBlocked = record.filter((e) => e.kind === "line_spoken" || e.kind === "line_blocked").length;
    expect(spokenOrBlocked).toBe([...opener, ...turn1, ...turn2, ...turn3].filter((e) => e.type === "line").length);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
    expect((await store.queue("quick_check")).map((q) => q.patientId)).toEqual([IDS.sam]);
    expect((await store.getCall(callId))?.state).toBe("ended");
  });

  it("gives the model the 12 strict buttons, the call's ids and the tool results", async () => {
    const { model } = await samsCall();
    const first = model.requests[0];
    expect(first.tools).toHaveLength(12);
    expect(first.tools.every((t) => t.strict === true)).toBe(true);
    expect(first.system).toContain(PHARMACY);
    expect(first.system).toContain(`the lookup id is ${lookup}`);
    expect(first.system).toContain(`rx_id ${IDS.samConcerta}`);
    expect(first.system).toContain(`You have already said to the caller: "${outboundOpener(PHARMACY, "Sam")}"`);

    const afterCheck = model.requests[3].messages.at(-1);
    expect(afterCheck?.role).toBe("user");
    expect(JSON.stringify(afterCheck?.content)).toContain('\\"verified\\":true');
  });

  it("tells the model what the caller heard when the guard replaced a line", async () => {
    const t = setup([...script, { text: ["Bye for now."] }]);
    const callId = await t.driver.startCall({ direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta });
    for (const said of ["Yes, this is Sam.", `It's ${CODE}.`, "Yes please.", "No, that's all."]) await collect(t.driver.callerSays(callId, said));
    const last = t.model.requests.at(-1)!.messages;
    const note = last.at(-1);
    expect(note?.role).toBe("system");
    expect(String(note?.content)).toContain('Instead of "Your Concerta refill is approved."');
  });

  it("works the same twice from a reset", async () => {
    const a = await samsCall();
    const b = await samsCall();
    expect((await b.store.listRecord()).map((e) => e.hash)).toEqual((await a.store.listRecord()).map((e) => e.hash));
  });
});

describe("1.2: the safety check runs before the model", () => {
  it("hands over when the caller asks for a person, without asking the model", async () => {
    const t = setup([]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "Can I talk to a real person please?"));
    expect(evs[0]).toMatchObject({ type: "safety", result: { action: "handover" } });
    expect(lines(evs)).toEqual([HANDOVER_SCRIPT]);
    expect(t.model.requests).toHaveLength(0);
    expect((await t.store.queue("review")).some((q) => q.kind === "escalation")).toBe(true);
  });
});

describe("1.2: every action is a button press", () => {
  it("refuses a tool that isn't one of the 12 buttons, and presses nothing", async () => {
    const t = setup([{ tools: [{ name: "change_address", input: { line1: "1 Fake St" } }] }, { text: ["Sorry, I can't do that."] }]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "Change my address."));
    expect(presses(evs)).toHaveLength(0);
    expect(JSON.stringify(t.model.requests[1].messages.at(-1))).toContain("no such button");
  });

  it("passes refused presses back as the result, unchanged", async () => {
    const t = setup([{ tools: [{ name: "read_label", input: { rx_id: IDS.samConcerta } }] }, { text: ["I need to verify you first."] }]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "What does my Concerta label say?"));
    expect(presses(evs)[0].result).toMatchObject({ ok: false, error: "not_verified" });
    expect(JSON.stringify(t.model.requests[1].messages.at(-1))).toContain("not_verified");
  });

  it("escalates through the button when the model refuses", async () => {
    const t = setup([{ stop: "refusal" }]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "Hello?"));
    expect(presses(evs).map((p) => p.button)).toEqual(["escalate"]);
    expect(lines(evs)).toEqual(["Let me get a pharmacist to help you with that."]);
  });

  it("hands over after too many steps for one line", async () => {
    const loop = { tools: [{ name: "order_status", input: {} }] };
    const t = setup([loop, loop, loop], 3);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "Where is my order?"));
    const pressed = presses(evs);
    expect(pressed.map((p) => p.button)).toEqual(["order_status", "order_status", "order_status", "escalate"]);
    expect(pressed.at(-1)?.input).toEqual({ reason: STUCK_REASON });
  });

  it("says nothing more once the call has ended", async () => {
    const t = setup([]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    await t.driver.endCall(callId);
    expect(await collect(t.driver.callerSays(callId, "Hello?"))).toEqual([{ type: "ended" }]);
  });
});
