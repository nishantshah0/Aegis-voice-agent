// The side-effect follow-up: when the caller mentions something, the agent asks
// when it started and whether it's mild or severe, then records it for the
// pharmacist. Never advice. Real lock, scripted model.
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "112358";
const lookup = outboundLookupId("c_0001");
const upToQuestion: ScriptStep[] = [
  { tools: [{ name: "check_code", input: { lookup_id: lookup, code: CODE, dob: "1990-03-14" } }] },
  { text: ["Want me to send your Concerta refill to the pharmacist now?"] },
  { tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] },
  { text: ["A pharmacist will check it first, and I'll confirm once it's approved."] },
];

async function call(steps: ScriptStep[], lines: string[]) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel(steps);
  const driver = createAgentDriver({ calls: control, press: control.press, guardSentence: createSpeechGuard({ store }), checkCallerLine: createSafetyCheck({ store }), model, pharmacyName: "Maple Street Pharmacy" });
  const callId = await driver.startCall({ direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
  await collect(driver.opening(callId));
  const turns: AgentEvent[][] = [];
  for (const l of [`It's ${CODE}, born 1990-03-14.`, "Yes please.", ...lines]) turns.push(await collect(driver.callerSays(callId, l)));
  /** The phone-system note added for that request's caller line, if any (the last message). */
  const systemNotes = (i: number) => {
    const last = model.requests[i].messages.at(-1);
    return last?.role === "system" ? [String(last.content)] : [];
  };
  return { store, model, turns, systemNotes };
}

describe("side-effect follow-up: when it started, and mild or severe", () => {
  it("asks the model to find out when it started and how bad, before the note, and never to advise", async () => {
    const t = await call([...upToQuestion, { text: ["When did that start, and is it mild or severe?"] }], ["Some headaches."]);
    const note = t.systemNotes(4).at(-1)!;
    expect(note).toMatch(/when it started/i);
    expect(note).toMatch(/mild or severe/i);
    expect(note).toMatch(/no advice/i);
  });

  it("keeps the side-effect note on the caller's follow-up answer, and records what, when and how bad", async () => {
    const t = await call(
      [
        ...upToQuestion,
        { text: ["When did that start, and is it mild or severe?"] },
        { tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samConcerta, kind: "side_effect", text: "Headaches, since about a week ago, mild" } }] },
        { text: ["Thanks, I've passed that to the pharmacist with your refill."] },
      ],
      ["Some headaches.", "About a week ago, pretty mild."],
    );
    expect(t.systemNotes(5).some((n) => /side-effect/i.test(n))).toBe(true);
    const review = await t.store.queue("review");
    expect(review.flatMap((q) => q.notes.map((n) => n.text))).toContain("Headaches, since about a week ago, mild");
  });

  it("stops treating lines as side-effect answers once the note is pressed", async () => {
    const t = await call(
      [
        ...upToQuestion,
        { tools: [{ name: "note_for_pharmacist", input: { rx_id: IDS.samConcerta, kind: "side_effect", text: "Mild headaches since last week" } }] },
        { text: ["Thanks, I've passed that to the pharmacist with your refill."] },
        { text: ["You're welcome."] },
      ],
      ["Mild headaches since last week.", "Thanks!"],
    );
    expect(t.systemNotes(6).some((n) => /side-effect/i.test(n))).toBe(false);
  });

  it("asks at most one follow-up: two lines after the question, it's no longer a side-effect answer", async () => {
    const t = await call(
      [...upToQuestion, { text: ["When did it start?"] }, { text: ["And how bad is it?"] }, { text: ["Okay."] }],
      ["Headaches.", "Not sure.", "What time does the pharmacy close?"],
    );
    expect(t.systemNotes(6).some((n) => /side-effect/i.test(n))).toBe(false);
  });
});
