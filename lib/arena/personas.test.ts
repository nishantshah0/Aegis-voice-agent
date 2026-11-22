import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDriver, Seed } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { watchStore } from "./live-session";
import type { OvernightSession } from "./overnight";
import { INTENTS, PERSONAS, pickPersonaCalls, runPersonaSuite, TWISTS, type CallerRequest, type PersonaCall } from "./personas";
import type { ScenarioTarget } from "./runner";

// Persona callers: a model plays a seeded, random patient from a grid of persona x
// intent x twist, against the real lock. Here the caller is scripted and the agent is a
// stand-in that presses buttons through the real control layer.

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "personas-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("pickPersonaCalls", () => {
  it("is reproducible from its seed and differs for another seed", () => {
    expect(pickPersonaCalls(42, 20)).toEqual(pickPersonaCalls(42, 20));
    expect(pickPersonaCalls(42, 20)).not.toEqual(pickPersonaCalls(43, 20));
  });

  it("spreads 20 calls over every persona and intent at least twice, with seed patients only", () => {
    const calls = pickPersonaCalls(7, 20);
    expect(calls).toHaveLength(20);
    for (const p of PERSONAS) expect(calls.filter((c) => c.persona === p.id).length).toBeGreaterThanOrEqual(2);
    for (const i of INTENTS) expect(calls.filter((c) => c.intent === i.id).length).toBeGreaterThanOrEqual(2);
    const twists = new Set(TWISTS.map((t) => t.id));
    for (const c of calls) {
      expect(twists.has(c.twist)).toBe(true);
      expect(INTENTS.find((i) => i.id === c.intent)!.seeds).toContain(c.seed);
    }
    expect(new Set(calls.map((c) => c.id)).size).toBe(20);
  });

  it("has the requested grid", () => {
    expect(PERSONAS.map((p) => p.id)).toEqual(["elderly_hard_of_hearing", "rushed", "angry", "chatty", "confused", "caregiver", "non_native_english", "several_prescriptions"]);
    expect(INTENTS.map((i) => i.id)).toEqual(["refill", "copay", "delivery_change", "label_question", "renewal", "side_effect", "status", "several"]);
    expect(TWISTS.map((t) => t.id)).toEqual(["interrupts", "corrects_itself", "goes_silent", "changes_mind"]);
  });
});

/** A stand-in agent on the real lock: looks up, verifies with the code it hears, then checks coverage. */
function session(): OvernightSession {
  return async (seed: Seed, target: ScenarioTarget, code: string, onRecord) => {
    const store = watchStore(createMemoryStore(seed), onRecord);
    const control = createControl({ store, makeCode: () => code });
    const guard = createSpeechGuard({ store });
    const safety = createSafetyCheck({ store });
    const patient = seed.patients.find((p) => p.id === target.patientId)!;
    const rx = seed.prescriptions.find((r) => r.id === target.rxId)!;
    let lookupId = "";
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        const check = await safety(callId, line);
        if (check.action !== "continue") return;
        if (!lookupId) {
          const r = await control.press(callId, "lookup_patient", { name: `${patient.firstName} ${patient.lastName}`, dob: patient.dob, rx_number: rx.rxNumber });
          if (r.ok) lookupId = r.output.lookup_id;
        } else if (line.includes(code)) {
          await control.press(callId, "check_code", { lookup_id: lookupId, code });
          await control.press(callId, "check_coverage", { rx_id: rx.id });
        }
        const said = await guard(callId, "One moment please, I will check that.");
        yield { type: "line", text: said.speak };
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

describe("runPersonaSuite", () => {
  const call: PersonaCall = { n: 1, id: "persona_001_rushed_copay_interrupts", persona: "rushed", intent: "copay", twist: "interrupts", seed: "p6_due" };

  it("plays each call until the caller hangs up, gives the caller the code once it is texted, and saves the scoreboard and transcript", async () => {
    const requests: CallerRequest[] = [];
    const caller = async (req: CallerRequest) => {
      requests.push(req);
      if (requests.length === 1) return "Hi, it's Tom, what do I pay?";
      if (requests.length === 2) return `The code is ${req.code}.`;
      return null;
    };
    let t = 0;
    const board = await runPersonaSuite({ calls: [call], caller, makeSession: session(), dir, runId: "run-1", seed: 99, model: "stand-in", callerModel: "scripted", now: () => (t += 250), makeCode: () => "135790" });

    expect(requests[0].code).toBeUndefined();
    expect(requests[0].system).toContain("Tom");
    expect(requests[1].code).toBe("135790");
    expect(requests[1].transcript.at(-1)).toEqual({ who: "agent", text: "One moment please, I will check that." });

    expect(board).toMatchObject({ seed: 99, model: "stand-in", callerModel: "scripted", planned: 1, calls: 1, failedCalls: 0, goalMet: 1, broken: 0 });
    expect(board.handover).toEqual({ none: 1, needed: 0, unnecessary: 0, missed: 0 });
    expect(board.medianTurnMs).toBe(250);
    expect(board.byIntent.find((i) => i.id === "copay")).toEqual({ id: "copay", calls: 1, goalMet: 1 });
    expect(board.results[0]).toMatchObject({ id: call.id, goalMet: true, turns: 2, turnsToGoal: 2, broken: [] });

    const saved = JSON.parse(await readFile(join(dir, "run-1", "scoreboard.json"), "utf8"));
    expect(saved).toMatchObject({ seed: 99, calls: 1, goalMet: 1 });
    expect(await readdir(join(dir, "run-1", "calls"))).toEqual(["001.json"]);
    const transcript = JSON.parse(await readFile(join(dir, "run-1", "calls", "001.json"), "utf8"));
    expect(transcript.transcript.map((l: { who: string }) => l.who)).toEqual(["caller", "agent", "caller", "agent"]);
    expect(transcript.record.length).toBeGreaterThan(0);
  });

  it("stops at the turn cap, and counts a call whose caller or agent failed without scoring it", async () => {
    const chatty = async () => "And another thing about my garden.";
    const capped = await runPersonaSuite({ calls: [call], caller: chatty, makeSession: session(), dir, runId: "run-2", seed: 1, maxTurns: 3 });
    expect(capped.results[0].turns).toBe(3);

    const broken = async () => { throw new Error("model down"); };
    const failed = await runPersonaSuite({ calls: [call], caller: broken, makeSession: session(), dir, runId: "run-3", seed: 1 });
    expect(failed).toMatchObject({ planned: 1, calls: 0, failedCalls: 1, goalMet: 0, results: [] });
    expect(failed.failures[0]).toMatchObject({ id: call.id, error: "model down" });
  });

  it("uses only seed data in the caller's brief", async () => {
    const seen: string[] = [];
    await runPersonaSuite({ calls: [{ ...call, seed: "p7_two_addresses", intent: "delivery_change" }], caller: async (r) => { seen.push(r.system); return null; }, makeSession: session(), dir, runId: "run-4", seed: 1 });
    const lena = SEED.patients.find((p) => p.firstName === "Lena")!;
    expect(seen[0]).toContain(lena.dob);
    expect(seen[0]).toContain("Thursday 9 to 12");
  });
});
