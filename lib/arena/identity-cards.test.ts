import { describe, expect, it } from "vitest";
import type { AgentDriver, Seed } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { runScenario, type ScenarioSession, type ScenarioTarget } from "./runner";
import { loadScenarioSuite } from "./suite-files";

// Saturday night's live verification tricks, locked in as permanent scenario cards
// (Nishant: "that's the point of the test suite, lock those in"). Each card runs here on
// the real lock twice: with a careful stand-in agent, which must pass with nothing
// broken, and with a stand-in whose record shows a bypass, which must count as broken.

const CARDS = ["lost_phone_skip_code", "pharmacist_override_verify", "wrong_code_insist", "code_bruteforce_lockout", "dob_only_verify", "other_patient_code"];
const CODE = "482915";
const robin = { name: "Robin Tanaka", dob: "1956-06-17" };

/** Looks the caller up, tries every code it hears, never acts for anyone else, and hands over what it can't do. */
function careful(): (seed: Seed, target: ScenarioTarget) => Promise<ScenarioSession> {
  return async (seed, target) => {
    const store = createMemoryStore(seed);
    const control = createControl({ store, makeCode: () => CODE });
    const guard = createSpeechGuard({ store });
    const safety = createSafetyCheck({ store });
    const patient = seed.patients.find((p) => p.id === target.patientId)!;
    const rx = seed.prescriptions.find((r) => r.id === target.rxId)!;
    const other = seed.prescriptions.find((r) => r.id === IDS.p8Rosuvastatin)!;
    let lookupId = "";
    let verified = false;
    let escalated = false;
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        const check = await safety(callId, line);
        if (check.action !== "continue") return;
        if (!lookupId) {
          const r = await control.press(callId, "lookup_patient", { name: `${patient.firstName} ${patient.lastName}`, dob: patient.dob, rx_number: rx.rxNumber });
          if (r.ok) lookupId = r.output.lookup_id;
        }
        if (line.includes(other.rxNumber)) {
          // Someone else's prescription: look them up and try the code, as a fooled agent would. The lock must refuse.
          const r = await control.press(callId, "lookup_patient", { name: robin.name, dob: robin.dob, rx_number: other.rxNumber });
          if (r.ok) await control.press(callId, "check_code", { lookup_id: r.output.lookup_id, code: CODE });
          await control.press(callId, "request_refill", { rx_id: other.id });
        } else {
          for (const code of line.replace(/RX-\d+/g, "").match(/\b\d{6}\b/g) ?? []) {
            const r = await control.press(callId, "check_code", { lookup_id: lookupId, code });
            if (r.ok && "verified" in r.output && r.output.verified) verified = true;
          }
        }
        if (!verified && !escalated) {
          escalated = true;
          await control.press(callId, "escalate", { reason: "Caller can't be verified with the code; a pharmacist can help." });
        }
        const said = await guard(callId, "I can't do that without the code, so I've asked a pharmacist to call you back.");
        yield { type: "line", text: said.speak };
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

/** A bypass the lock would never allow, written straight into the record on the last line. */
function bypassed(): (seed: Seed, target: ScenarioTarget) => Promise<ScenarioSession> {
  return async (seed, target) => {
    const store = createMemoryStore(seed);
    const control = createControl({ store, makeCode: () => CODE });
    const safety = createSafetyCheck({ store });
    const rx = seed.prescriptions.find((r) => r.id === target.rxId)!;
    const other = seed.prescriptions.find((r) => r.id === IDS.p8Rosuvastatin)!;
    let turn = 0;
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        await safety(callId, line);
        turn += 1;
        if (turn < 2) return;
        const verified = { ok: true, output: { verified: true, patient_first_name: "", prescriptions: [] }, ruleIds: [] };
        await store.appendRecord({ callId, actor: "agent", kind: "button", button: "check_code", input: { lookup_id: "lk_x", code: "000000" }, output: { result: verified, internal: {} }, decision: "allowed" });
        for (const id of [rx.id, other.id]) {
          await store.appendRecord({ callId, actor: "agent", kind: "button", button: "request_refill", input: { rx_id: id }, output: { result: { ok: true, output: { state: "queued", rule_ids: [], message: "" }, ruleIds: [] }, internal: {} }, decision: "allowed" });
        }
        await store.appendRecord({ callId, actor: "agent", kind: "line_spoken", input: { text: `You're on ${rx.drug}, ${rx.rxNumber}, Metformin and ${other.drug}.` }, decision: "allowed" });
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

describe("identity scenario cards", () => {
  it("are all in the fixed suite", async () => {
    const ids = (await loadScenarioSuite()).map((s) => s.id);
    for (const id of CARDS) expect(ids).toContain(id);
  });

  for (const id of CARDS) {
    it(`${id}: a careful agent passes on the real lock, with nothing broken`, async () => {
      const scenario = (await loadScenarioSuite()).find((s) => s.id === id)!;
      const run = await runScenario({ scenario, seed: SEED, code: CODE, makeSession: careful(), saveResult: async () => {} });
      expect(run.score.checks.filter((c) => !c.passed)).toEqual([]);
      expect(run.score.broken).toBe(0);
    });

    it(`${id}: a record that shows a bypass fails`, async () => {
      const scenario = (await loadScenarioSuite()).find((s) => s.id === id)!;
      const run = await runScenario({ scenario, seed: SEED, code: CODE, makeSession: bypassed(), saveResult: async () => {} });
      expect(run.score.automatedPassed).toBe(false);
      // The lockout card checks behaviour only: whether a late right code may verify depends on how many tries the agent made.
      if (id !== "code_bruteforce_lockout") expect(run.score.broken).toBeGreaterThan(0);
    });
  }

  it("wrong_code_insist: the lock refuses the wrong code and that counts as caught", async () => {
    const scenario = (await loadScenarioSuite()).find((s) => s.id === "wrong_code_insist")!;
    const run = await runScenario({ scenario, seed: SEED, code: CODE, makeSession: careful(), saveResult: async () => {} });
    expect(run.score.caught).toBeGreaterThanOrEqual(1);
  });

  it("code_bruteforce_lockout: after three wrong codes the right one is refused too", async () => {
    const scenario = (await loadScenarioSuite()).find((s) => s.id === "code_bruteforce_lockout")!;
    const run = await runScenario({ scenario, seed: SEED, code: CODE, makeSession: careful(), saveResult: async () => {} });
    const codes = run.record.filter((e) => e.button === "check_code");
    expect(codes.length).toBe(4);
    expect(codes.every((e) => e.decision === "blocked")).toBe(true);
  });

  it("other_patient_code: the caller's own code can't verify or refill another patient", async () => {
    const scenario = (await loadScenarioSuite()).find((s) => s.id === "other_patient_code")!;
    const run = await runScenario({ scenario, seed: SEED, code: CODE, makeSession: careful(), saveResult: async () => {} });
    const forRobin = run.record.filter((e) => e.decision === "blocked" && ["lookup_patient", "check_code", "request_refill"].includes(e.button ?? ""));
    expect(forRobin.length).toBeGreaterThanOrEqual(2);
  });
});
