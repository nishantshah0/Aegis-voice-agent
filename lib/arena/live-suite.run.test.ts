import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CALL_MODEL, createClaudeModel, createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS, type AgentModel } from "@/lib/agent";
import { SEED } from "@/lib/seed";
import { liveSessionMaker } from "./live-session";
import { waitForRoom } from "./pace";
import { runFixedScenarioSuite } from "./suite-files";

// The fixed suite (3.5) on the live agent: every scenario 3 times, through Role 1's driver
// on the Messages API when configured, or on the paced Agent SDK.
// Opt in, since it spends model calls:
//   LIVE_SUITE=1 LIVE_AGENT=1 npx vitest run lib/arena/live-suite.run.test.ts
// LIVE_SUITE_ONLY=id,id runs a few scenarios (a smoke run); LIVE_SUITE_RESULTS=<dir> saves elsewhere. Results go to
// results/arena/scenarios/<run>/ (scoreboard.json, attempts/<scenario>/<n>.json).

const live = process.env.LIVE_SUITE === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!live)("fixed scenario suite on the live agent", () => {
  it("runs every scenario 3 times and saves the real scoreboard", { timeout: DAY_MS }, async () => {
    const useMessages = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!useMessages) expect(process.env.LIVE_AGENT, "the SDK requires LIVE_AGENT=1").toBe("1");
    const modelName = useMessages ? CALL_MODEL : process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL;
    const provider = useMessages ? createClaudeModel({ model: modelName }) : createAgentSdkModel({ model: modelName });
    const modelTurnsByCall: Record<string, number> = {};
    const model: AgentModel = {
      ...provider,
      async *turn(request) {
        yield* provider.turn(request);
        modelTurnsByCall[request.callId] = (modelTurnsByCall[request.callId] ?? 0) + 1;
      },
    };
    const beforeTurn = useMessages ? undefined : () => waitForRoom({ need: SDK_MAX_TURNS });
    const only = process.env.LIVE_SUITE_ONLY?.split(",").map((id) => id.trim()).filter(Boolean);
    const { report, resultPath } = await runFixedScenarioSuite({
      seed: SEED,
      makeCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
      makeSession: (seed, target, code) => liveSessionMaker({ model, code, beforeTurn })(seed, target),
      retries: 2,
      // One call at a time, so pacing before each line holds the hourly cap.
      concurrency: 1,
      emit: (event) => {
        if (event.type === "score") console.log(`[live-suite] ${new Date().toISOString()} caught ${event.caught}, broken ${event.broken}`);
      },
      ...(only?.length ? { only } : {}),
      ...(process.env.LIVE_SUITE_RESULTS ? { resultsDirectory: process.env.LIVE_SUITE_RESULTS } : {}),
    });
    // Name the agent model in the scoreboard, so runs on different models can be compared.
    await writeFile(resultPath, `${JSON.stringify({ model: modelName, transport: useMessages ? "messages" : "agent-sdk", modelTurnsByCall, ...JSON.parse(await readFile(resultPath, "utf8")) }, null, 2)}\n`);
    console.log(`[live-suite] saved ${resultPath}: ${report.passed}/${report.totalScenarios} passing 3 of 3, caught ${report.caught}, broken ${report.broken}, retried ${report.retried}`);
    expect(report.completed).toBe(true);
    if (only?.length) expect(report.scenarios.map((s) => s.id).sort()).toEqual([...new Set(only)].sort());
  });
});
