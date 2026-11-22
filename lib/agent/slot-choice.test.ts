// 1.x (Trail #75, final Sonnet run): naming one of the offered times picks that slot.
// "The Wednesday one", "Thursday at 2", "the first one", "the later one", "the 2 o'clock",
// a date ("the 26th", "November 26 at 2") all resolve to one offered slot, which the driver
// then reads back, asks the consent question for, and books only on yes. Anything that
// doesn't pin down exactly one offered slot still re-offers, so nothing is guessed.

import { describe, expect, it } from "vitest";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import type { AppointmentOffer } from "@/lib/contract/buttons";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { chooseCalendarOffer } from "./appointments";
import { createAgentDriver } from "./driver";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const SLOTS: AppointmentOffer[] = [
  { slot_id: "consult_wed_10", slot_label: "Wednesday, November 25 at 10 AM Eastern", availability_text: "The pharmacist has an appointment available on Wednesday, November 25 at 10 AM Eastern." },
  { slot_id: "consult_thu_14", slot_label: "Thursday, November 26 at 2 PM Eastern", availability_text: "The pharmacist has an appointment available on Thursday, November 26 at 2 PM Eastern." },
];

describe("1.x: naming one of the offered times picks it", () => {
  it.each([
    ["The Wednesday one.", "consult_wed_10"],
    ["The Wednesday one, please book it.", "consult_wed_10"],
    ["Thursday at 2.", "consult_thu_14"],
    ["Thursday at 2 works.", "consult_thu_14"],
    ["The first one.", "consult_wed_10"],
    ["The earlier one please.", "consult_wed_10"],
    ["The later one.", "consult_thu_14"],
    ["Let's do the second one.", "consult_thu_14"],
    ["The last one.", "consult_thu_14"],
    ["The 2 o'clock.", "consult_thu_14"],
    ["The 10 o'clock one.", "consult_wed_10"],
    ["Wednesday the 25th.", "consult_wed_10"],
    ["The one on the 26th.", "consult_thu_14"],
    ["November 26 at 2.", "consult_thu_14"],
    ["Book me for the 25th at 10 AM.", "consult_wed_10"],
  ])("%s", (said, slot) => {
    expect(chooseCalendarOffer(said, SLOTS)?.slot_id).toBe(slot);
  });
});

describe("1.x: still never guesses", () => {
  it.each([
    "Wednesday at 4 PM",
    "Wednesday or Thursday",
    "not Wednesday",
    "Wednesday at ten thirty AM",
    "Wednesday next month",
    "Wednesday at 10 Pacific",
    "Thursday morning",
    "Wednesday at 7",
    "Friday instead",
    "The third one.",
    "The 27th.",
    "Wednesday the 26th.",
    "The first or the second one.",
    "December 25 at 10.",
    "The 3 o'clock.",
  ])("%s re-offers", (said) => {
    expect(chooseCalendarOffer(said, SLOTS)).toBeUndefined();
  });
});

describe("1.x: through the real driver and lock", () => {
  it("offers both, then 'the later one' reads back Thursday, asks, and books only on yes", async () => {
    const CODE = "135790";
    const press = (name: string, input: unknown): ScriptStep => ({ tools: [{ name, input }] });
    const say = (...text: string[]): ScriptStep => ({ text });
    const store = createMemoryStore(SEED);
    const control = createControl({ store, makeCode: () => CODE });
    const model = scriptedModel([
      say("What is your date of birth?"),
      press("lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" }),
      say("Please read the code back to me."),
      press("check_code", { lookup_id: "lk_c_0001_1", code: CODE }),
      say("Thanks, Tom."),
    ]);
    const driver = createAgentDriver({ calls: control, press: control.press, guardSentence: createSpeechGuard({ store }), checkCallerLine: createSafetyCheck({ store }), model, pharmacyName: SEED.pharmacyName });
    const callId = await driver.startCall({ direction: "inbound" });
    const tell = async (text: string) => (await collect(driver.callerSays(callId, text))).flatMap((e) => (e.type === "line" ? [e.text] : []));
    for (const line of ["I'm Tom Brennan, prescription RX-100701.", "September 21, 1983.", `The code is ${CODE}.`]) await tell(line);

    expect(await tell("I'd like to meet with the pharmacist. What times do you have?")).toEqual([SLOTS[0].availability_text, SLOTS[1].availability_text, "Which of those times would you like?"]);
    expect(await tell("The later one.")).toEqual([SLOTS[1].availability_text, APPOINTMENT_CONFIRMATION_QUESTION]);
    expect(await store.listAppointments()).toEqual([]);
    expect(await tell("Yes please.")).toEqual(["Your pharmacist appointment is booked for Thursday, November 26 at 2 PM Eastern."]);
    expect(await store.listAppointments()).toMatchObject([{ slotId: "consult_thu_14", patientId: IDS.p6 }]);
  });
});
