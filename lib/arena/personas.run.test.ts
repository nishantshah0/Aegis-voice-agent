import { randomInt } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS } from "@/lib/agent";
import { liveSessionMaker } from "./live-session";
import { createSdkCaller } from "./persona-caller";
import { pickPersonaCalls, runPersonaSuite } from "./personas";
import { waitForRoom } from "./pace";

// Persona callers on the live agent. Opt in, since it spends model calls:
//   PERSONAS=1 LIVE_AGENT=1 npx vitest run lib/arena/personas.run.test.ts
// PERSONAS_CALLS (default 20) and PERSONAS_SEED (default random, saved in the scoreboard)
// pick the grid; PERSONAS_LABEL names the run (e.g. baseline). Paced with every other live
// run on this machine under the hourly cap. Writes results/arena/personas/<run>/, or PERSONAS_DIR.

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(process.env.PERSONAS !== "1")("persona callers on the live agent", () => {
  it("plays seeded persona calls, scores safety and helpfulness, and saves the scoreboard", { timeout: DAY_MS }, async () => {
    expect(process.env.LIVE_AGENT, "set LIVE_AGENT=1 (and no ANTHROPIC_API_KEY)").toBe("1");
    const modelName = process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL;
    const model = createAgentSdkModel({ model: modelName });
    const seed = process.env.PERSONAS_SEED ? Number(process.env.PERSONAS_SEED) : randomInt(0, 2 ** 31);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const board = await runPersonaSuite({
      calls: pickPersonaCalls(seed, Number(process.env.PERSONAS_CALLS || 20)),
      caller: createSdkCaller({ model: SDK_DEV_MODEL, beforeCall: () => waitForRoom({ need: 1 }) }),
      makeSession: (fixture, target, code, onRecord) => liveSessionMaker({ model, code, onRecord })(fixture, target),
      beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }),
      dir: process.env.PERSONAS_DIR || join(process.cwd(), "results", "arena", "personas"),
      runId: process.env.PERSONAS_LABEL ? `${stamp}-${process.env.PERSONAS_LABEL}` : stamp,
      seed,
      model: modelName,
      callerModel: SDK_DEV_MODEL,
    });
    console.log(`[personas] seed ${board.seed}: ${board.calls} calls, goal met ${board.goalMet}, broken ${board.broken}, caught ${board.caught}, hand-overs ${JSON.stringify(board.handover)}, median turn ${board.medianTurnMs} ms, ${board.failedCalls} failed. ${board.stoppedBecause ?? ""}`);
    expect(board.calls).toBeGreaterThan(0);
  });
});
