import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { createFakes, FAKE_CODE } from "@/lib/contract/fakes";
import { createControl } from "@/lib/control";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { runScenario, scenarioTokens, resolveScenarioText, type Scenario, type ScenarioRun } from "./runner";
import { scoreScenario } from "./score";

async function loadScenario(name: string): Promise<Scenario> {
  const path = new URL(`../../scenarios/${name}`, import.meta.url);
  return JSON.parse(await readFile(path, "utf8")) as Scenario;
}

describe("scenario runner", () => {
  it("replays every card through AgentDriver and scores only its record", async () => {
    const files = (await readdir(new URL("../../scenarios/", import.meta.url))).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(10);
    const saved: ScenarioRun[] = [];
    const emitted: StreamEvent[] = [];

    for (const file of files) {
      const scenario = await loadScenario(file);
      const result = await runScenario({
        scenario,
        seed: SEED,
        code: FAKE_CODE,
        makeSession: async (seed) => {
          const { store, driver } = createFakes();
          await store.reset(seed);
          return { store, driver };
        },
        saveResult: async (run) => { saved.push(run); },
        emit: (event) => {
          expect(saved.at(-1)?.scenarioId).toBe(scenario.id);
          emitted.push(event);
        },
      });
      expect(result.callerLines).toHaveLength(scenario.caller_lines.length);
      expect(result.callerLines.every((line) => !line.includes("{{"))).toBe(true);
      expect(result.score.checks.length).toBeGreaterThan(0);
      expect(result.record.filter((entry) => entry.kind === "caller_line")).toHaveLength(scenario.caller_lines.length);
    }

    expect(saved).toHaveLength(files.length);
    expect(emitted).toHaveLength(files.length);
    expect(emitted.every((event) => event.type === "score")).toBe(true);
    expect(saved.some((run) => !run.score.automatedPassed)).toBe(true);
  });

  it("scores a verified refill from button records rather than driver events", async () => {
    const scenario = await loadScenario("sam-ordinary-refill.json");
    const { store, press, driver } = createFakes();
    const callId = await driver.startCall({ direction: "inbound" });
    const tokens = scenarioTokens(scenario, SEED, FAKE_CODE);
    const lookup = await press(callId, "lookup_patient", {
      name: tokens["patient.name"], dob: tokens["patient.dob"], rx_number: tokens["rx.number"],
    });
    if (!lookup.ok) throw new Error("lookup failed");
    await press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code: FAKE_CODE });
    await press(callId, "request_refill", { rx_id: tokens["rx.id"] });

    const score = scoreScenario(scenario.expected, await store.listRecord(callId), (text) => resolveScenarioText(text, tokens));
    expect(score.automatedPassed).toBe(true);
    expect(score.checks.every((check) => check.passed)).toBe(true);
    expect(score.broken).toBe(0);
  });

  it("rejects unknown fixture tokens", async () => {
    const scenario = await loadScenario("sam-ordinary-refill.json");
    const tokens = scenarioTokens(scenario, SEED, FAKE_CODE);
    expect(() => resolveScenarioText("{{unknown}}", tokens)).toThrow("unknown scenario token");
  });

  it("counts a private line from the record as a broken check", async () => {
    const scenario = await loadScenario("preverification-leak.json");
    const { store, driver } = createFakes();
    const callId = await driver.startCall({ direction: "inbound" });
    const tokens = scenarioTokens(scenario, SEED, FAKE_CODE);
    await store.appendRecord({
      callId,
      actor: "agent",
      kind: "line_spoken",
      input: { text: `Your prescription ${tokens["rx.number"]} is ready.` },
      decision: "allowed",
    });

    const score = scoreScenario(scenario.expected, await store.listRecord(callId), (text) => resolveScenarioText(text, tokens));
    expect(score.broken).toBeGreaterThan(0);
    expect(score.automatedPassed).toBe(false);
  });

  it("does not emit an unsaved score", async () => {
    const scenario = await loadScenario("person-please.json");
    const emitted: StreamEvent[] = [];
    await expect(runScenario({
      scenario,
      seed: SEED,
      code: FAKE_CODE,
      makeSession: async (seed) => {
        const { store, driver } = createFakes();
        await store.reset(seed);
        return { store, driver };
      },
      saveResult: async () => { throw new Error("save failed"); },
      emit: (event) => { emitted.push(event); },
    })).rejects.toThrow("save failed");
    expect(emitted).toEqual([]);
  });

  it("accepts either pharmacist handoff action from the record", async () => {
    const scenario = await loadScenario("dose-not-on-label.json");
    const { store, driver, press } = createFakes();
    const callId = await driver.startCall({ direction: "inbound" });
    await press(callId, "escalate", { reason: "Question beyond label" });
    const tokens = scenarioTokens(scenario, SEED, FAKE_CODE);
    const score = scoreScenario(scenario.expected, await store.listRecord(callId), (text) => resolveScenarioText(text, tokens));
    expect(score.checks.find((check) => check.id === "handover_or_note")?.passed).toBe(true);
  });

  it("reads the real control layer's nested button results", async () => {
    for (const file of ["sam-ordinary-refill.json", "controlled-too-early.json"]) {
      const scenario = await loadScenario(file);
      const tokens = scenarioTokens(scenario, SEED, FAKE_CODE);
      const store = createMemoryStore(SEED);
      const control = createControl({ store, makeCode: () => FAKE_CODE });
      const callId = await control.startInboundCall();
      const lookup = await control.press(callId, "lookup_patient", {
        name: tokens["patient.name"], dob: tokens["patient.dob"], rx_number: tokens["rx.number"],
      });
      if (!lookup.ok) throw new Error("lookup failed");
      await control.press(callId, "check_code", { lookup_id: lookup.output.lookup_id, code: FAKE_CODE });
      await control.press(callId, "request_refill", { rx_id: tokens["rx.id"] });

      const score = scoreScenario(scenario.expected, await store.listRecord(callId), (text) => resolveScenarioText(text, tokens));
      expect(score.automatedPassed).toBe(true);
    }
  });
});
