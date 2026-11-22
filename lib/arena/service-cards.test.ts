import { describe, expect, it } from "vitest";
import type { AgentDriver, Seed } from "@/lib/contract";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { runScenario, type ScenarioSession, type ScenarioTarget } from "./runner";
import { loadScenarioSuite } from "./suite-files";

// "Make sure this agent can do it all" (Nishant): callers who correct themselves, book
// and ask about pharmacist appointments, ask about their history, change the supply, or
// want a pirate voice while booking. Each card runs here on the real lock with a scripted
// agent that does the job right (it must pass, nothing broken) and with one that never
// acts (it must fail), so a card can't pass on its own.

const CARDS = ["dob_self_correction", "dob_wrong_then_right", "booking_time_correction", "booking_info_questions", "history_questions_varied", "persona_plus_booking", "supply_correction"];
const CODE = "482915";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The last full date in a line: 1990-03-14, or March 14, 1990. */
export function lastDate(line: string): string | undefined {
  const found: string[] = [];
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of line.matchAll(/\b([A-Za-z]+) (\d{1,2}), (\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase());
    if (month >= 0) found.push(`${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`);
  }
  return found.at(-1);
}

const longDate = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));

/** A scripted agent that does each card's job the way the lock expects. idle: it only listens. */
function agent(idle = false): (seed: Seed, target: ScenarioTarget) => Promise<ScenarioSession> {
  return async (seed, target) => {
    const store = createMemoryStore(seed);
    const control = createControl({ store, makeCode: () => CODE });
    const guard = createSpeechGuard({ store });
    const safety = createSafetyCheck({ store });
    const patient = seed.patients.find((p) => p.id === target.patientId)!;
    const rx = seed.prescriptions.find((r) => r.id === target.rxId)!;
    let lookupId = "";
    let verified = false;
    let offered = "";
    let days: number | undefined;
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        const check = await safety(callId, line);
        if (check.action !== "continue") return;
        if (idle) return;
        const said: string[] = [];
        const say = async (text: string) => said.push((await guard(callId, text)).speak);
        const lower = line.toLowerCase();
        const dob = lastDate(line);
        if (!verified && dob) {
          const r = await control.press(callId, "lookup_patient", { name: `${patient.firstName} ${patient.lastName}`, dob, rx_number: rx.rxNumber });
          if (r.ok) lookupId = r.output.lookup_id;
        }
        for (const code of line.replace(/RX-\d+/g, "").match(/\b\d{6}\b/g) ?? []) {
          const r = await control.press(callId, "check_code", { lookup_id: lookupId, code });
          verified ||= r.ok && "verified" in r.output && r.output.verified === true;
        }
        if (/one week|one-week|seven/.test(lower)) days = 7;
        if (!verified) {
          await say("Could you read me the code we texted to your phone?");
        } else if (/please book it|^yes/.test(lower) && offered) {
          const r = await control.press(callId, "note_for_pharmacist", { kind: "appointment", slot_id: offered });
          if (r.ok && "confirmation_text" in r.output) await say(r.output.confirmation_text);
          offered = "";
        } else if (/appointment again|when's my appointment/.test(lower)) {
          const r = await control.press(callId, "order_status", { include_appointments: true });
          for (const a of r.ok ? (r.output.appointments ?? []) : []) await say(a.confirmation_text);
        } else if (/move it/.test(lower)) {
          await say("I can't move a booking myself, so I've left the pharmacist a note to call you about it.");
          await control.press(callId, "note_for_pharmacist", { kind: "question", text: "Caller would like to move the appointment." });
        } else if (/pharmacist|appointment|thursday|wednesday|times/.test(lower)) {
          const r = await control.press(callId, "order_status", { include_appointments: true });
          const slots = r.ok ? (r.output.appointment_slots ?? []) : [];
          const wanted = /thursday/.test(lower) ? slots.find((s) => s.slot_id === "consult_thu_14") : /wednesday/.test(lower) ? slots.find((s) => s.slot_id === "consult_wed_10") : undefined;
          if (wanted) {
            await say(wanted.availability_text);
            await say(APPOINTMENT_CONFIRMATION_QUESTION);
            offered = wanted.slot_id;
          } else {
            for (const s of slots) await say(s.availability_text);
          }
        } else if (/last (get|got|pick)/.test(lower)) {
          const r = await control.press(callId, "check_prescription", { rx_id: rx.id, include_other_names: false });
          if (r.ok) await say(`You last got it on ${longDate(r.output.last_fill)}.`);
        } else if (/cost|pay/.test(lower)) {
          const r = await control.press(callId, "check_coverage", { rx_id: rx.id, ...(days ? { days_supply: days } : {}) });
          if (r.ok && r.output.patient_pays) await say(`You pay ${r.output.patient_pays}.`);
        } else if (/refills/.test(lower)) {
          const r = await control.press(callId, "check_prescription", { rx_id: rx.id, include_other_names: false });
          // History lines must match the button's readback (S4), as the real agent says it.
          if (r.ok) await say(r.output.history_readback);
        } else if (/refill|request/.test(lower)) {
          await control.press(callId, "request_refill", { rx_id: rx.id, ...(days ? { days_supply: days } : {}) });
          await say("Your refill request is in. A pharmacist will check it.");
        } else {
          await say("Thanks, you're verified. How can I help?");
        }
        for (const text of said) yield { type: "line", text };
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

const run = async (id: string, idle = false) => {
  const scenario = (await loadScenarioSuite()).find((s) => s.id === id)!;
  return runScenario({ scenario, seed: SEED, code: CODE, makeSession: agent(idle), saveResult: async () => {} });
};

describe("patient service cards", () => {
  it("reads the last full date in a line, after a correction", () => {
    expect(lastDate("March 4... I mean March 14, 1990.")).toBe("1990-03-14");
    expect(lastDate("It's 1983-09-21.")).toBe("1983-09-21");
    expect(lastDate("No date here.")).toBeUndefined();
  });

  it("are all in the fixed suite", async () => {
    const ids = (await loadScenarioSuite()).map((s) => s.id);
    for (const id of CARDS) expect(ids).toContain(id);
  });

  for (const id of CARDS) {
    it(`${id}: an agent that does the job passes on the real lock, with nothing broken`, async () => {
      const r = await run(id);
      expect(r.score.checks.filter((c) => !c.passed)).toEqual([]);
      expect(r.score.broken).toBe(0);
    });

    it(`${id}: an agent that never acts fails`, async () => {
      const r = await run(id, true);
      expect(r.score.automatedPassed).toBe(false);
      expect(r.score.broken).toBe(0);
    });
  }

  it("dob_wrong_then_right: the wrong date's lookup sends no usable code; the right one verifies", async () => {
    const r = await run("dob_wrong_then_right");
    expect(r.record.filter((e) => e.button === "lookup_patient")).toHaveLength(2);
    expect(r.record.filter((e) => e.button === "check_code" && e.decision === "allowed")).toHaveLength(1);
  });
});
