import { describe, expect, it } from "vitest";
import type { AgentDriver, Seed } from "@/lib/contract";
import { APPOINTMENT_CONFIRMATION_QUESTION } from "@/lib/contract/appointment-consent";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { BUSINESS_CASES, businessCase, CATEGORIES } from "./business-cases";
import { runScenario, type ScenarioSession, type ScenarioTarget } from "./runner";
import { recordMatches } from "./score";
import { loadScenarioSuite } from "./suite-files";

// The Business tests persona library: each case is a scenario card (caller turns and
// record checks) with a title and a category. Every case runs here on the real lock with
// a scripted agent that does the right thing, and must pass; an idle agent must fail.

const CODE = "482915";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The last full date in a line: 1990-03-14, March 14, 1990, or 21 September 1983. */
function lastDate(line: string): string | undefined {
  const found: { at: number; iso: string }[] = [];
  const iso = (y: string, m: number, d: string) => `${y}-${String(m + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push({ at: m.index!, iso: `${m[1]}-${m[2]}-${m[3]}` });
  for (const m of line.matchAll(/\b([A-Za-z]+) (\d{1,2}),? (\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase());
    if (month >= 0) found.push({ at: m.index!, iso: iso(m[3]!, month, m[2]!) });
  }
  for (const m of line.matchAll(/\b(\d{1,2}) ([A-Za-z]+),? (\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase());
    if (month >= 0) found.push({ at: m.index!, iso: iso(m[3]!, month, m[1]!) });
  }
  return found.sort((a, b) => a.at - b.at).at(-1)?.iso;
}

/** A scripted agent that verifies, refills, books with consent, follows the safety check, and stays itself. */
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
    let ended = false;
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        if (ended) return;
        const check = await safety(callId, line);
        if (idle) return;
        const said: string[] = [];
        const say = async (text: string) => said.push((await guard(callId, text)).speak);
        if (check.action !== "continue") {
          // The safety check's own script, spoken as is; the call stops there.
          await store.appendRecord({ callId, actor: "agent", kind: "line_spoken", input: { text: check.script }, decision: "allowed" });
          said.push(check.script);
          ended = true;
        } else {
          const lower = line.toLowerCase();
          const forSomeoneElse = /calling for my|for my (brother|mom|mother|dad|father|sister|wife|husband)|pretend you're my doctor/.test(lower);
          const dob = lastDate(line);
          if (!verified && dob && !forSomeoneElse) {
            const r = await control.press(callId, "lookup_patient", { name: `${patient.firstName} ${patient.lastName}`, dob, rx_number: rx.rxNumber });
            if (r.ok) lookupId = r.output.lookup_id;
          }
          for (const code of lookupId ? (line.replace(/RX-\d+/g, "").match(/\b\d{6}\b/g) ?? []) : []) {
            const r = await control.press(callId, "check_code", { lookup_id: lookupId, code });
            verified ||= r.ok && "verified" in r.output && r.output.verified === true;
          }
          if (forSomeoneElse || /poem/.test(lower)) {
            await say("I can only help the patient themselves, after they're verified with the code we text them. A pharmacist can help with anything else.");
          } else if (!verified) {
            await say(lookupId ? "Could you read me the code we texted you?" : "I can help. What's your date of birth?");
          } else if (/please book it/.test(lower) && offered) {
            const r = await control.press(callId, "note_for_pharmacist", { kind: "appointment", slot_id: offered });
            if (r.ok && "confirmation_text" in r.output) await say(r.output.confirmation_text);
            offered = "";
          } else if (/pharmacist|times|thursday|wednesday/.test(lower)) {
            const r = await control.press(callId, "order_status", { include_appointments: true });
            const slots = r.ok ? (r.output.appointment_slots ?? []) : [];
            const wanted = /thursday/.test(lower) ? slots.find((s) => s.slot_label.startsWith("Thursday")) : /wednesday/.test(lower) ? slots.find((s) => s.slot_label.startsWith("Wednesday")) : undefined;
            if (wanted) {
              await say(wanted.availability_text);
              await say(APPOINTMENT_CONFIRMATION_QUESTION);
              offered = wanted.slot_id;
            } else for (const s of slots) await say(s.availability_text);
          } else if (/refill|more|pills|done|medicine/.test(lower)) {
            await control.press(callId, "request_refill", { rx_id: rx.id });
            await say("Your refill request is in. A pharmacist will check it.");
          } else {
            await say("You're verified. How can I help?");
          }
        }
        for (const text of said) yield { type: "line", text };
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

const run = async (scenarioId: string, idle = false) => {
  const scenario = (await loadScenarioSuite()).find((s) => s.id === scenarioId)!;
  return runScenario({ scenario, seed: SEED, code: CODE, makeSession: agent(idle), saveResult: async () => {} });
};

describe("Business tests persona library", () => {
  it("has the sixteen requested cases, each a fixed-suite card with a title and a category", async () => {
    const ids = new Set((await loadScenarioSuite()).map((s) => s.id));
    expect(BUSINESS_CASES).toHaveLength(16);
    expect(new Set(BUSINESS_CASES.map((c) => c.id)).size).toBe(16);
    for (const c of BUSINESS_CASES) {
      expect(ids.has(c.scenarioId)).toBe(true);
      expect(CATEGORIES).toContain(c.category);
      expect(c.title.length).toBeGreaterThan(0);
    }
    expect(new Set(BUSINESS_CASES.map((c) => c.category))).toEqual(new Set(CATEGORIES));
  });

  it("gives each case its scripted caller turns and record checks from the card", () => {
    const pirate = businessCase("pirate");
    expect(pirate.callerLines.length).toBeGreaterThan(0);
    expect(pirate.checks.length).toBeGreaterThan(0);
    expect(() => businessCase("nope")).toThrow();
  });

  const NEW = ["pretend_doctor", "poem_request", "angry_caller", "confused_elderly_repeats", "rushed_caller", "non_native_english", "crisis_not_here_anymore", "overdose_whole_bottle", "booking_named_slot", "family_member_no_permission"];
  for (const scenarioId of NEW) {
    it(`${scenarioId}: a scripted agent that does the right thing passes on the real lock, with nothing broken`, async () => {
      const r = await run(scenarioId);
      expect(r.score.checks.filter((c) => !c.passed)).toEqual([]);
      expect(r.score.broken).toBe(0);
    });

    it(`${scenarioId}: an idle agent fails`, async () => {
      expect((await run(scenarioId, true)).score.automatedPassed).toBe(false);
    });
  }

  it("the crisis and overdose lines are caught by the real safety check, not the script", async () => {
    for (const [id, action] of [["crisis_not_here_anymore", "crisis"], ["overdose_whole_bottle", "emergency"]] as const) {
      const r = await run(id, true);
      expect(r.record.some((e) => recordMatches(e, { kind: "safety", safetyAction: action }))).toBe(true);
    }
  });
});
