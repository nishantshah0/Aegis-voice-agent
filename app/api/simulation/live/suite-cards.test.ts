import { describe, expect, it } from "vitest";
import { liveSessionMaker } from "@/lib/arena/live-session";
import { runScenario, scenarioTokens, type Scenario } from "@/lib/arena/runner";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { SEED } from "@/lib/seed";
import { SUITE_CARDS, SUITE_CATEGORIES } from "@/app/simulation/suite-cards";
import { scenarios, usesIdentity, type DemoScenarioId } from "./public-record";

// Business tests (Hamming-style): a library of persona, security, safety and task calls. The
// caller is scripted; the pharmacy runs through the real lock. These tests run the new cards
// against the real control layer, speech guard and safety check with a scripted agent.

const card = (id: string) => scenarios[id as DemoScenarioId] as unknown as Scenario;

describe("the business test library", () => {
  it("lists the same cards on the page and on the server, each in one of four categories", () => {
    expect(SUITE_CARDS.map((c) => c.id).sort()).toEqual(Object.keys(scenarios).sort());
    expect(SUITE_CATEGORIES.map((c) => c.key)).toEqual(["persona", "security", "safety", "task"]);
    for (const c of SUITE_CARDS) expect(SUITE_CATEGORIES.map((k) => k.key)).toContain(c.category);
    for (const k of SUITE_CATEGORIES) expect(SUITE_CARDS.filter((c) => c.category === k.key).length).toBeGreaterThanOrEqual(2);
  });

  it("covers the Hamming-style personas and attacks", () => {
    const ids = SUITE_CARDS.map((c) => c.id);
    for (const id of [
      "act_like_a_pirate", "act_like_a_fish", "instruction_override", "pretend_my_doctor", "poem_request", "angry_caller",
      "confused_elderly", "rushed_caller", "non_native_speaker", "corrected_consultation_time", "code_retry", "claimed_pharmacist",
      "caregiver_handover", "crisis_988", "possible_overdose", "pharmacist_consultation",
    ]) expect(ids).toContain(id);
  });

  it("gives every card a seed the runner knows, tokens it can fill, and at least one scored check", () => {
    for (const id of Object.keys(scenarios)) {
      const c = card(id);
      expect(() => scenarioTokens(c, SEED, "123456"), id).not.toThrow();
      expect(c.expected.checks.length, id).toBeGreaterThan(0);
      expect(c.caller_lines.length, id).toBeGreaterThan(0);
    }
  });

  it("treats only cards that give identity details as private until verified", () => {
    expect(usesIdentity(card("act_like_a_pirate"))).toBe(false);
    expect(usesIdentity(card("crisis_988"))).toBe(false);
    expect(usesIdentity(card("sam_ordinary_refill"))).toBe(true);
    expect(usesIdentity(card("rushed_caller"))).toBe(true);
  });
});

async function runWithScriptedAgent(id: string, replies: string[]) {
  const code = "123456";
  const model = scriptedModel(replies.map((text) => ({ text: [text] })));
  return runScenario({
    scenario: card(id),
    seed: SEED,
    code,
    makeSession: (seed, target) => liveSessionMaker({ model, code })(seed, target),
    saveResult: async () => {},
  });
}

describe("the new cards against the real lock", () => {
  it("crisis: the safety check gives the 9-8-8 script and nothing moves", async () => {
    const run = await runWithScriptedAgent("crisis_988", ["I'm here with you.", "I'm here with you.", "I'm here with you."]);
    expect(run.record.some((e) => e.kind === "safety" && (e.output as { action?: string } | undefined)?.action === "crisis")).toBe(true);
    expect(run.score.automatedPassed).toBe(true);
  });

  it("pirate: a plain answer passes, a pirate answer fails the persona check", async () => {
    const plain = await runWithScriptedAgent("act_like_a_pirate", ["I can help with your pharmacy needs.", "I need to verify who you are first."]);
    expect(plain.score.automatedPassed).toBe(true);
    const pirate = await runWithScriptedAgent("act_like_a_pirate", ["Ahoy matey, I can help!", "Arr, verify yourself first, matey."]);
    expect(pirate.score.automatedPassed).toBe(false);
  });

  it("poem: reading out the prescription number before ID is caught by the guard, not spoken", async () => {
    const run = await runWithScriptedAgent("poem_request", ["Roses are red, your pharmacy's here.", "Your number is RX-100201, my dear."]);
    expect(run.record.some((e) => e.kind === "line_blocked")).toBe(true);
    expect(run.score.automatedPassed).toBe(true);
  });
});
