import { describe, expect, it } from "vitest";
import { runScenario } from "@/lib/arena/runner";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import { coverageFacts } from "@/lib/contract/patient-facts";
import type { Seed } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { createAgentDriver } from "./driver";
import { collect, scriptedModel, type ScriptStep } from "./testing/scripted-model";

const code = "135790";
const slotId = "consult_wed_10";
const offer = "The pharmacist has an appointment available on Wednesday, November 25 at 10 AM Eastern.";
const booked = "Your pharmacist appointment is booked for Wednesday, November 25 at 10 AM Eastern.";
const press = (name: string, input: unknown): ScriptStep => ({ tools: [{ name, input }] });
const say = (text: string): ScriptStep => ({ text: [text] });
const identify = [
  say("What is your date of birth?"),
  press("lookup_patient", { name: "Tom Brennan", dob: "1983-09-21", rx_number: "RX-100701" }),
  say("Please read the code back to me."),
  press("check_code", { lookup_id: "lk_c_0001_1", code }),
];

function session(steps: ScriptStep[], seed: Seed = SEED) {
  const store = createMemoryStore(seed);
  const control = createControl({ store, makeCode: () => code });
  const driver = createAgentDriver({
    calls: control, press: control.press, guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }), model: scriptedModel(steps), pharmacyName: seed.pharmacyName,
  });
  return { store, driver };
}

const bookingSteps = [
  ...identify,
  press("order_status", { include_appointments: true }), say(offer),
  press("note_for_pharmacist", { kind: "appointment", slot_id: slotId, text: "Book the Wednesday appointment." }),
  say("One moment."),
];

async function startVerified(steps: ScriptStep[]) {
  const { store, driver } = session(steps);
  const callId = await driver.startCall({ direction: "inbound" });
  const tell = (text: string) => collect(driver.callerSays(callId, text));
  for (const line of ["I'm Tom Brennan, prescription RX-100701.", "September 21, 1983.", `The code is ${code}.`]) await tell(line);
  expect((await store.getCall(callId))?.state).toBe("verified");
  return { store, driver, tell, callId };
}

describe("patient service consent through the phone driver", () => {
  it("completes the suite's consultation card with the real guard, reservation and verdict", async () => {
    const scenario = (await loadScenarioSuite()).find((card) => card.id === "pharmacist_consultation")!;
    const run = await runScenario({
      scenario, seed: SEED, code, makeSession: async (seed) => session(bookingSteps, seed), saveResult: async () => {},
    });
    expect(run.score.checks.filter((c) => !c.passed)).toEqual([]);
    expect(run.score.automatedPassed).toBe(true);
    expect(run.record.some((e) => e.kind === "line_spoken" && (e.input as { text: string }).text === booked)).toBe(true);
  });

  it("uses the selected supply's insurance record and passes the one-week suite verdict", async () => {
    const scenario = (await loadScenarioSuite()).find((card) => card.id === "one_week_supply")!;
    const rx = SEED.prescriptions.find((r) => r.id === IDS.p6Amlodipine)!;
    const input = { rx_id: rx.id, days_supply: 7 };
    const steps = [...identify,
      press("check_coverage", input), say(coverageFacts(rx, 7).coverage_readback),
      press("request_refill", input), say("One moment."),
      say("Your refill request is for a 7-day supply."),
    ];
    const run = await runScenario({
      scenario, seed: SEED, code, makeSession: async (seed) => session(steps, seed), saveResult: async () => {},
    });
    expect(run.score.checks.filter((c) => !c.passed)).toEqual([]);
    expect(run.score.automatedPassed).toBe(true);
  });

  it("says a fourteen-day estimate is missing, and never places an order for a price inquiry", async () => {
    const rx = SEED.prescriptions.find((r) => r.id === IDS.p6Amlodipine)!;
    const missing = coverageFacts(rx, 14);
    expect(missing.available).toBe(false);
    const t = await startVerified([...identify,
      press("check_coverage", { rx_id: rx.id, days_supply: 14 }), say(missing.coverage_readback),
    ]);
    const lines = await t.store.listRecord(t.callId);
    expect(lines.some((e) => e.kind === "line_spoken" && (e.input as { text: string }).text === missing.coverage_readback)).toBe(true);
    await t.driver.endCall(t.callId);
    expect(await t.store.listOrders(IDS.p6)).toEqual([]);
  });

  it.each(["No thanks.", "Maybe, what if I need to reschedule?", "Yes, but only if Thursday works."])(
    "does not book on an ambiguous or declined reply (%s)", async (reply) => {
      const t = await startVerified([...bookingSteps, say("We can check other times.")]);
      const question = await t.tell("The Wednesday one works. Could you book it?");
      expect(question).toContainEqual({ type: "line", text: APPOINTMENT_CONFIRMATION_QUESTION });
      await t.tell(reply);
      await t.driver.endCall(t.callId);
      expect(await t.store.listAppointments()).toEqual([]);
    },
  );

  it("reports a newly unavailable slot without speaking a successful booking", async () => {
    const t = await startVerified(bookingSteps);
    await t.tell("Book the Wednesday one.");
    await t.store.reserveAppointment({ slotId, patientId: IDS.sam, bookedAt: SEED.now });
    const result = await t.tell("Please do.");
    expect(result.some((e) => e.type === "line" && e.text.includes("couldn't book"))).toBe(true);
    expect(result.some((e) => e.type === "line" && e.text === booked)).toBe(false);
    expect((await t.store.listAppointments()).map((a) => a.patientId)).toEqual([IDS.sam]);
  });

  it.each([
    "Cancel my refill.",
    "Actually, only seven days instead.",
    "I'm not sure I want a refill yet. How much is it?",
  ])("never submits the old 14-day request after '%s', including at hangup", async (reply) => {
    const t = await startVerified([
      ...identify, say("How can I help?"),
      press("request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 14 }), say("One moment."),
      say("I can check that with you."),
    ]);
    await t.tell("I'd like a 14-day refill.");
    expect(await t.store.listOrders(IDS.p6)).toEqual([]);
    await t.tell(reply);
    await t.driver.endCall(t.callId);
    expect(await t.store.listOrders(IDS.p6)).toEqual([]);
  });
});
