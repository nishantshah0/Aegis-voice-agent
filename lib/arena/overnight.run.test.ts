import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS } from "@/lib/agent";
import { createSdkAttacker } from "./attacker";
import { liveSessionMaker } from "./live-session";
import { runOvernight } from "./overnight";
import { waitForRoom } from "./pace";

// The overnight run (3.7) on the live agent. Opt in, since it spends model calls:
//   OVERNIGHT=1 LIVE_AGENT=1 npx vitest run lib/arena/overnight.run.test.ts
// OVERNIGHT_CALLS caps the attack calls (default 60); OVERNIGHT_UNTIL (an ISO time) stops
// it starting new ones. Paced with every other live run on this machine under the hourly
// cap. Writes results/arena/overnight/<run>/ (report.json, calls/, gaps/), or OVERNIGHT_DIR.

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(process.env.OVERNIGHT !== "1")("overnight run on the live agent", () => {
  it("attacks, judges each call with the hammer's invariants, and saves the report", { timeout: DAY_MS }, async () => {
    expect(process.env.LIVE_AGENT, "set LIVE_AGENT=1 (and no ANTHROPIC_API_KEY)").toBe("1");
    const modelName = process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL;
    const model = createAgentSdkModel({ model: modelName });
    const until = process.env.OVERNIGHT_UNTIL ? Date.parse(process.env.OVERNIGHT_UNTIL) : undefined;
    const report = await runOvernight({
      attacker: createSdkAttacker({ model: modelName, beforeCall: () => waitForRoom({ need: 1 + SDK_MAX_TURNS }) }),
      makeSession: (seed, target, code, onRecord) =>
        liveSessionMaker({ model, code, onRecord, beforeTurn: () => waitForRoom({ need: SDK_MAX_TURNS }) })(seed, target),
      maxCalls: Number(process.env.OVERNIGHT_CALLS || 60),
      ...(until !== undefined && Number.isFinite(until) ? { until } : {}),
      dir: process.env.OVERNIGHT_DIR || join(process.cwd(), "results", "arena", "overnight"),
      runId: new Date().toISOString().replace(/[:.]/g, "-"),
      model: modelName,
    });
    console.log(`[overnight] ${report.calls} calls, caught ${report.caught}, broken ${report.broken}, ${report.gaps.length} gaps, ${report.failedCalls} failed, ${report.badPlans} bad plans. ${report.stoppedBecause ?? ""}`);
    expect(report.calls).toBeGreaterThan(0);
  });
});
