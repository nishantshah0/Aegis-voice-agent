import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS } from "@/lib/agent";
import { createGeminiAttacker, createSdkAttacker } from "./attacker";
import { attackerFamily, DEFAULT_ATTACKER_MODEL, GEMINI_ATTACKER_MODEL, type AttackerModel } from "./attacker-models";
import { crossModelSummary, type CrossModelRun } from "./cross-model";
import { liveSessionMaker } from "./live-session";
import { runOvernight } from "./overnight";
import { waitForRoom } from "./pace";

// The cross-model red-team run (3.7g) on the live agent: the same tactics, attacked by a
// Gemini caller and then by a Claude caller, ~10 attack calls each. Opt in, since it spends
// model calls (Claude's under the hourly cap, Gemini's on GEMINI_API_KEY):
//   CROSS_MODEL=1 LIVE_AGENT=1 npx vitest run lib/arena/cross-model.run.test.ts
// CROSS_MODEL_CALLS (default 10) per attacker. Each run is results/arena/overnight/<run>/
// (report.json with attacker, calls/, gaps/); the summary is results/arena/cross-model/<run>.json.

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(process.env.CROSS_MODEL !== "1")("cross-model red-team run on the live agent", () => {
  it("attacks with Gemini and with Claude, judges every call with the hammer's invariants, and saves both reports", { timeout: DAY_MS }, async () => {
    expect(process.env.LIVE_AGENT, "set LIVE_AGENT=1").toBe("1");
    expect(process.env.GEMINI_API_KEY, "set GEMINI_API_KEY in .env").toBeTruthy();
    const modelName = process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL;
    const model = createAgentSdkModel({ model: modelName });
    const calls = Number(process.env.CROSS_MODEL_CALLS || 10);
    const results = process.env.RESULTS_DIR || join(process.cwd(), "results");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runs: CrossModelRun[] = [];

    for (const attackerModel of [GEMINI_ATTACKER_MODEL, DEFAULT_ATTACKER_MODEL] as AttackerModel[]) {
      const family = attackerFamily(attackerModel);
      const beforeCall = () => waitForRoom({ need: (family === "claude" ? 1 : 0) + SDK_MAX_TURNS });
      const runId = `${stamp}-${family}`;
      const report = await runOvernight({
        attacker: family === "gemini" ? createGeminiAttacker({ model: attackerModel, beforeCall }) : createSdkAttacker({ model: attackerModel, beforeCall }),
        makeSession: (seed, target, code, onRecord) => liveSessionMaker({ model, code, onRecord, beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }) })(seed, target),
        maxCalls: calls,
        dir: join(results, "arena", "overnight"),
        runId,
        model: modelName,
        attackerModel,
      });
      console.log(`[cross-model] ${family}: ${report.calls} calls, caught ${report.caught}, broken ${report.broken}, ${report.gaps.length} gaps, ${report.failedCalls} failed, ${report.badPlans} bad plans. ${report.stoppedBecause ?? ""}`);
      runs.push({ runId, report });
    }

    const summary = { ranAt: stamp, agentModel: modelName, ...crossModelSummary(runs) };
    const dir = join(results, "arena", "cross-model");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${stamp}.json`);
    await writeFile(`${path}.pending`, `${JSON.stringify(summary, null, 2)}\n`);
    await rename(`${path}.pending`, path);
    console.log(`[cross-model] ${summary.families.join(" + ")}: ${summary.calls} calls, caught ${summary.caught}, broken ${summary.broken}. ${path}`);
    expect(summary.calls).toBeGreaterThan(0);
  });
});
