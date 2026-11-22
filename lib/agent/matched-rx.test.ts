// 1.x (Trail #75, final Sonnet run): Sam gives RX-100201 up front and still hears
// "Concerta or Metformin?". check_code now returns matched_rx_id (the lock's own
// match), and the agent uses it: the prompt says so, and fact questions default to it.

import { describe, expect, it } from "vitest";
import { lastFillFacts } from "@/lib/contract/patient-facts";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { systemPrompt } from "./prompt";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const CODE = "135790";
const press = (name: string, input: unknown): ScriptStep => ({ tools: [{ name, input }] });
const say = (...text: string[]): ScriptStep => ({ text });

async function samGivesNumber(rxNumber: string) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const model = scriptedModel([
    press("lookup_patient", { name: "Sam Rivera", dob: "1990-03-14", rx_number: rxNumber }),
    say("If those details match, I've sent a code to the phone on file."),
    press("check_code", { lookup_id: "lk_c_0001_1", code: CODE }),
    say("Thanks, Sam."),
  ]);
  const driver = createAgentDriver({ calls: control, press: control.press, guardSentence: createSpeechGuard({ store }), checkCallerLine: createSafetyCheck({ store }), model, pharmacyName: SEED.pharmacyName });
  const callId = await driver.startCall({ direction: "inbound" });
  const tell = async (text: string) => (await collect(driver.callerSays(callId, text))).flatMap((e) => (e.type === "line" ? [e.text] : []));
  await tell(`Sam Rivera, March 14 1990, ${rxNumber}.`);
  await tell(`${CODE}.`);
  return { model, tell };
}

describe("1.x: the RX number the caller gave picks the prescription", () => {
  it("the prompt says to use matched_rx_id and not ask which one", () => {
    for (const direction of ["inbound", "outbound"] as const) {
      const prompt = systemPrompt({ pharmacyName: SEED.pharmacyName, direction });
      expect(prompt).toMatch(/matched_rx_id/);
      expect(prompt).toMatch(/don't ask which drug they mean/i);
    }
  });

  it("the model sees matched_rx_id in the check_code result", async () => {
    const t = await samGivesNumber("RX-100201");
    expect(JSON.stringify(t.model.requests.at(-1)?.messages)).toContain(`\\"matched_rx_id\\":\\"${IDS.samConcerta}\\"`);
  });

  it.each([
    ["RX-100201", IDS.samConcerta],
    ["RX-100202", IDS.samMetformin],
  ])("a fill-history question after giving %s answers for that prescription, with no 'which one?'", async (rxNumber, rxId) => {
    const t = await samGivesNumber(rxNumber);
    const said = await t.tell("When did I last fill it?");
    const rx = SEED.prescriptions.find((r) => r.id === rxId)!;
    expect(said).toEqual([lastFillFacts(rx).history_readback]);
    expect(said.join(" ")).not.toMatch(/which prescription/i);
  });
});
