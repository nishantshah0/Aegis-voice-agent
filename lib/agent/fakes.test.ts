// 1.2 "done when": Sam's typed call works end to end against the contract fakes.
import { describe, expect, it } from "vitest";
import { createFakes, FAKE_CODE, SAM_CONCERTA } from "@/lib/contract/fakes";
import { createAgentDriver } from "./driver";
import { collect, scriptedModel } from "./testing/scripted-model";

describe("1.2: Sam's typed inbound call against the fakes", () => {
  it("looks Sam up, verifies the code and asks for his refill, all through the fakes", async () => {
    const fakes = createFakes();
    const model = scriptedModel([
      { tools: [{ name: "lookup_patient", input: { name: "Sam Rivera", dob: "1990-03-14", rx_number: "RX-100201" } }] },
      { text: ["If those details match, I've sent a code to the phone on file."] },
      { tools: [{ name: "check_code", input: { lookup_id: "lk_c_fake_1_1", code: FAKE_CODE } }] },
      { tools: [{ name: "request_refill", input: { rx_id: SAM_CONCERTA } }] },
      // 1.x: the driver holds the refill and asks the side-effect question; the answer places it.
      { text: ["Sure."] },
      { text: ["A pharmacist will check your refill first."] },
    ]);
    const driver = createAgentDriver({
      calls: fakes.driver,
      press: fakes.press,
      guardSentence: fakes.guardSentence,
      checkCallerLine: fakes.checkCallerLine,
      model,
      pharmacyName: "Maple Street Pharmacy",
    });
    const callId = await driver.startCall({ direction: "inbound" });
    const turn1 = await collect(driver.callerSays(callId, "Sam Rivera, March 14 1990, RX-100201."));
    const turn2 = await collect(driver.callerSays(callId, `The code is ${FAKE_CODE}, and I'd like my Concerta refilled.`));

    expect(turn1.filter((e) => e.type === "line")).toEqual([{ type: "line", text: "If those details match, I've sent a code to the phone on file." }]);
    const turn3 = await collect(driver.callerSays(callId, "No side effects."));
    const pressed = [...turn2, ...turn3].flatMap((e) => (e.type === "press" ? [e] : []));
    expect(pressed[0].result).toMatchObject({ ok: true, output: { verified: true, patient_first_name: "Sam" } });
    // 1.x (Trail #75): after the code checks out, the driver checks each prescription and its cost.
    expect(pressed.map((e) => e.button)).toEqual(expect.arrayContaining(["check_prescription", "check_coverage"]));
    expect(pressed.find((e) => e.button === "request_refill")).toMatchObject({ result: { ok: true } });
    expect(model.remaining()).toBe(0);
    await driver.endCall(callId);
  });
});
