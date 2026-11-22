import { describe, expect, it } from "vitest";
import type { RecordEntry } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import incident from "@/app/simulation/fixtures/greeting-slang-report.json";
import { liveSessionMaker } from "./live-session";
import { scoreScenario } from "./score";
import { runScenarioSuite } from "./suite";
import { loadScenarioSuite } from "./suite-files";

async function scenario() {
  const card = (await loadScenarioSuite()).find(entry => entry.id === incident.id);
  if (!card) throw new Error("The caller-reported incident is missing from the fixed suite");
  return card;
}

// Only the speaker, words and line ordering are known for this user-supplied transcript.
const transcript: RecordEntry[] = incident.lines.map(({ line, speaker, text }) => ({
  seq: line, id: String(line), at: "", prevHash: "", hash: "",
  kind: speaker === "caller" ? "caller_line" : "line_spoken",
  actor: speaker === "caller" ? "caller" : "agent", input: { text },
}));

describe("greetings, unclear speech and silence on the patient phone", () => {
  it("fails the actual reported transcript even though no backend violation was observed", async () => {
    const card = await scenario();
    expect(incident.lines.filter(line => line.speaker === "caller").map(line => line.text)).toEqual(card.caller_lines);
    const verdict = scoreScenario(card.expected, transcript, t => t);
    expect(verdict.automatedPassed).toBe(false);
    expect(verdict.broken).toBe(0);
    expect(verdict.checks.filter(c => !c.passed).map(c => c.id)).toEqual([
      "no_spoken_handoff", "one_prompt_during_the_pause", "offers_pharmacy_help_turn_1",
      "offers_pharmacy_help_turn_2", "offers_pharmacy_help_turn_5",
      "clarifies_or_offers_help_turn_3", "clarifies_or_offers_help_turn_4",
    ]);
  });

  it("scores replies on their own turn even when the caller repeats the same words", async () => {
    const card = await scenario();
    const updated = transcript.map(entry => entry.seq === 13 ? { ...entry, input: { text: "Can I help with a refill?" } } : entry);
    const verdict = scoreScenario(card.expected, updated, t => t);
    expect(verdict.checks.find(c => c.id === "offers_pharmacy_help_turn_1")?.passed).toBe(false);
    expect(verdict.checks.find(c => c.id === "offers_pharmacy_help_turn_5")?.passed).toBe(true);
  });

  it("exercises the real silence handler and can pass three isolated phone sessions", async () => {
    const report = await runScenarioSuite({
      seed: SEED, scenarios: [await scenario()], makeCode: () => "000123",
      makeSession: (seed, target, code) => {
        const model = scriptedModel([
          { text: ["Could you say that again?"] }, { text: ["What do you need help with today?"] },
        ]);
        return liveSessionMaker({ code, model })(seed, target);
      },
      saveReport: async () => {},
    });
    expect(report.scenarios[0].attempts.map(a => a.checks.filter(c => !c.passed))).toEqual([[], [], []]);
    expect(report.passed).toBe(1);
  });
});

// Re-evaluate the preserved live trials whenever the greeting rubric changes.
it("supports the displayed live retest with each saved phone transcript", async () => {
  const { readFile } = await import("node:fs/promises");
  const { rescoreAttempt } = await import("./rescore");
  const card = await scenario();
  for (const trial of [1, 2, 3]) {
    const path = new URL(`../../results/arena/scenarios-models/claude-sonnet-5-5/8e353bdb-228e-4d90-8a60-b0ef2922476f/attempts/greeting_slang_recovery/${trial}.json`, import.meta.url);
    const score = rescoreAttempt(card, JSON.parse(await readFile(path, "utf8")));
    expect(score.checks.filter(c => !c.passed)).toEqual([]);
  }
});
