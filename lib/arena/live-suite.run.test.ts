import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS } from "@/lib/agent";
import { SEED } from "@/lib/seed";
import { liveSessionMaker } from "./live-session";
import { waitForRoom } from "./pace";
import { runFixedScenarioSuite } from "./suite-files";

// The fixed suite (3.5) on the live agent: every scenario 3 times, through Role 1's driver
// on the Claude Agent SDK, paced so this machine's live runs stay under the hourly cap.
// Opt in, since it spends model calls:
//   LIVE_SUITE=1 LIVE_AGENT=1 npx vitest run lib/arena/live-suite.run.test.ts
// LIVE_SUITE_ONLY=id,id runs a few scenarios (a smoke run); LIVE_SUITE_RESULTS=<dir> saves elsewhere. Results go to
// results/arena/scenarios/<run>/ (scoreboard.json, attempts/<scenario>/<n>.json).

const live = process.env.LIVE_SUITE === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!live)("fixed scenario suite on the live agent", () => {
  it("runs every scenario 3 times and saves the real scoreboard", { timeout: DAY_MS }, async () => {
    // Without it the SDK refuses every turn, and nothing here may be scored.
    expect(process.env.LIVE_AGENT, "set LIVE_AGENT=1 (and no ANTHROPIC_API_KEY)").toBe("1");
    const model = createAgentSdkModel({ model: process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL });
    const only = process.env.LIVE_SUITE_ONLY?.split(",").map((id) => id.trim()).filter(Boolean);
    const { report, resultPath } = await runFixedScenarioSuite({
      seed: SEED,
      makeCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
      makeSession: (seed, target, code) => liveSessionMaker({ model, code, beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }) })(seed, target),
      retries: 2,
      // One call at a time, so pacing before each line holds the hourly cap.
      concurrency: 1,
      emit: (event) => {
        if (event.type === "score") console.log(`[live-suite] ${new Date().toISOString()} caught ${event.caught}, broken ${event.broken}`);
      },
      ...(only?.length ? { only } : {}),
      ...(process.env.LIVE_SUITE_RESULTS ? { resultsDirectory: process.env.LIVE_SUITE_RESULTS } : {}),
    });
    console.log(`[live-suite] saved ${resultPath}: ${report.passed}/${report.totalScenarios} passing 3 of 3, caught ${report.caught}, broken ${report.broken}, retried ${report.retried}`);
    expect(report.completed).toBe(true);
  });
});
