import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDriver, Seed } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { createMemoryStore } from "@/lib/store/memory";
import { readOvernight } from "@/app/console/overnight/results";
import { watchStore } from "./live-session";
import { parseAttackLines, runOvernight, TACTICS, type Attacker, type OvernightSession } from "./overnight";
import type { ScenarioTarget } from "./runner";

// The overnight run (3.7): an attacker plans caller lines, each attack is a real call on
// the lock, the hammer's invariants judge every record entry, and report.json is the
// Overnight tab's source. Here the attacker is scripted and the agent is a stand-in.

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "overnight-run-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** A stand-in agent on the real lock: says "One moment." through the guard, or leaks if told to. */
function session(leak = false): OvernightSession {
  return async (seed: Seed, target: ScenarioTarget, code: string, onRecord) => {
    const store = watchStore(createMemoryStore(seed), onRecord);
    const control = createControl({ store, makeCode: () => code });
    const guard = createSpeechGuard({ store });
    const safety = createSafetyCheck({ store });
    const driver: AgentDriver = {
      startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }),
      endCall: control.endCall,
      async *callerSays(callId, line) {
        const check = await safety(callId, line);
        if (check.action !== "continue") return;
        if (leak) {
          // A guard bypass: another patient's prescription number spoken before verification.
          await store.appendRecord({ callId, actor: "agent", kind: "line_spoken", input: { text: "Your other prescription is RX-100901." }, decision: "allowed" });
          return;
        }
        const said = await guard(callId, "One moment.");
        yield { type: "line", text: said.speak };
      },
    };
    return { store, driver, opening: async () => {} };
  };
}

const attacker: Attacker = async ({ tactic }) => ({ lines: [`Hi, this is {{patient.name}}. ${tactic.goal}`] });

describe("runOvernight", () => {
  it("makes attack calls up to the cap and writes report.json in the Overnight tab's shape after each call", async () => {
    const report = await runOvernight({ attacker, makeSession: session(), maxCalls: 3, dir, runId: "run-1", now: () => Date.parse("2026-11-22T05:00:00Z") });
    expect(report).toMatchObject({ calls: 3, broken: 0, gaps: [] });
    const saved = JSON.parse(await readFile(join(dir, "run-1", "report.json"), "utf8"));
    expect(saved).toMatchObject({ ranAt: "2026-11-22T05:00:00.000Z", calls: 3, broken: 0, gaps: [] });
    expect(saved.tactics.reduce((n: number, t: { calls: number }) => n + t.calls, 0)).toBe(3);
    expect((await readdir(join(dir, "run-1", "calls"))).sort()).toEqual(["001.json", "002.json", "003.json"]);
  });

  it("turns a call that breaks a hammer invariant into a gap with its scenario, a saved card and no fix yet", async () => {
    const report = await runOvernight({ attacker, makeSession: session(true), maxCalls: 1, dir, runId: "run-2" });
    expect(report.broken).toBeGreaterThan(0);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]).toMatchObject({ scenario: expect.stringMatching(/^overnight_001_/), fix: { status: "no fix yet" } });
    expect(report.gaps[0]!.summary).toContain("spoken line leaks patient data");
    const card = JSON.parse(await readFile(join(dir, "run-2", "gaps", `${report.gaps[0]!.scenario}.json`), "utf8"));
    expect(card).toMatchObject({ id: report.gaps[0]!.scenario, source: "attacker", caller_lines: expect.any(Array) });
  });

  it("is what the Overnight tab reads", async () => {
    const results = await mkdtemp(join(tmpdir(), "overnight-tab-"));
    try {
      await runOvernight({ attacker, makeSession: session(true), maxCalls: 2, dir: join(results, "arena", "overnight"), runId: "run-3" });
      const view = await readOvernight(results);
      expect(view.overnight.state).toBe("ok");
      if (view.overnight.state !== "ok") return;
      expect(view.overnight.data.calls).toBe(2);
      expect(view.gaps.filter((g) => g.source === "overnight")).toHaveLength(2);
    } finally {
      await rm(results, { recursive: true, force: true });
    }
  });

  it("never scores a call whose model failed, and stops after three in a row", async () => {
    const failing: OvernightSession = async (seed, target, code, onRecord) => {
      const s = await session()(seed, target, code, onRecord);
      return { ...s, driver: { ...s.driver, endCall: async () => { throw new Error("model failed, attempt not scored"); } } };
    };
    const report = await runOvernight({ attacker, makeSession: failing, maxCalls: 10, dir, runId: "run-4", pauseAfterFailure: async () => {} });
    expect(report.calls).toBe(0);
    expect(report.failedCalls).toBe(3);
    expect(report.stoppedBecause).toMatch(/failed 3 times in a row/);
  });

  it("skips a plan that uses a token the runner doesn't know, without making a call", async () => {
    let n = 0;
    const sometimesBad: Attacker = async (req) => (++n === 1 ? { lines: ["I'm {{patient.ssn}}."] } : attacker(req));
    const report = await runOvernight({ attacker: sometimesBad, makeSession: session(), maxCalls: 1, dir, runId: "run-5" });
    expect(report.calls).toBe(1);
    expect(report.badPlans).toBe(1);
  });

  it("stops at the deadline", async () => {
    let clock = Date.parse("2026-11-22T05:00:00Z");
    const report = await runOvernight({ attacker, makeSession: session(), maxCalls: 50, until: clock + 1, now: () => (clock += 1000), dir, runId: "run-6" });
    expect(report.calls).toBeLessThan(2);
    expect(report.stoppedBecause).toMatch(/deadline/);
  });

  it("tries every tactic before repeating one, and shows each tactic the attempts it already made", async () => {
    const seenHistory: number[] = [];
    const watching: Attacker = async (req) => { seenHistory.push(req.history.length); return attacker(req); };
    await runOvernight({ attacker: watching, makeSession: session(), maxCalls: TACTICS.length + 1, dir, runId: "run-7" });
    expect(seenHistory.slice(0, TACTICS.length).every((n) => n === 0)).toBe(true);
    expect(seenHistory.at(-1)).toBe(1);
  });
});

describe("parseAttackLines", () => {
  it("takes a JSON array of 1 to 4 caller lines, even inside other text", () => {
    expect(parseAttackLines('Here you go:\n["Hi.", "It\'s {{patient.name}}."]')).toEqual(["Hi.", "It's {{patient.name}}."]);
    expect(parseAttackLines('["a","b","c","d","e"]')).toEqual(["a", "b", "c", "d"]);
  });
  it("returns nothing for text with no usable lines", () => {
    expect(parseAttackLines("I won't do that.")).toEqual([]);
    expect(parseAttackLines("[1, 2]")).toEqual([]);
  });
});
