import { describe, expect, it } from "vitest";
import { hourlyUse, waitForRoom } from "./pace";

// Live runs share Nishant's plan, so they pace on results/agent-usage.jsonl: every
// process that runs the live agent writes one line per turn there, with its model calls.

const HOUR = 60 * 60 * 1000;
const line = (at: number, modelCalls: number) => JSON.stringify({ at: new Date(at).toISOString(), callId: "c_0001", model: "claude-haiku-5-5", modelCalls });

describe("hourlyUse", () => {
  it("adds up model calls from the last hour only, counting each turn as at least one", () => {
    const now = Date.parse("2026-11-21T20:00:00Z");
    const log = [line(now - HOUR - 1, 9), line(now - 10_000, 3), line(now - 5_000, 0), "not json", ""].join("\n");
    expect(hourlyUse(log, now)).toBe(4);
  });
});

describe("waitForRoom", () => {
  it("returns at once when a whole turn fits under the cap", async () => {
    let slept = 0;
    const now = Date.parse("2026-11-21T20:00:00Z");
    await waitForRoom({ need: 4, perHour: 60, readLog: async () => line(now - 1000, 50), now: () => now, sleep: async (ms) => { slept += ms; } });
    expect(slept).toBe(0);
  });

  it("waits until old turns leave the hour, so the cap never trips mid-call", async () => {
    let clock = Date.parse("2026-11-21T20:00:00Z");
    const log = [line(clock - HOUR + 90_000, 40), line(clock - 1000, 18)].join("\n");
    let slept = 0;
    await waitForRoom({
      need: 4,
      perHour: 60,
      readLog: async () => log,
      now: () => clock,
      sleep: async (ms) => { slept += ms; clock += ms; },
    });
    // 58 used; the 40 drop out after 90 s, then 18 + 4 fits.
    expect(slept).toBeGreaterThanOrEqual(90_000);
    expect(slept).toBeLessThan(5 * 60_000);
  });
});
