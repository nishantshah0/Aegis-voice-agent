// Red-team break RT-HOST-1 (Trail #86), on main f51b2e3: the hosted presenter's scripted menu
// flow (app/api/presenter/phone/flow.ts nextFlow, also the browser demo's fallback) never runs
// checkCallerLine. RULES 1.2: every caller line goes through checkCallerLine first. After the
// demo PIN, a caller who says they want to die, took the whole bottle, can't breathe, or asks
// for a pharmacist hears the menu again: no 911 or 9-8-8 script, no flag, no handover.
// Each case asserts the SAFE outcome. Closed on main: nextFlow runs checkCallerLine first (Trail #70).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRISIS_SCRIPT, EMERGENCY_SCRIPT, HANDOVER_SCRIPT } from "@/lib/guard";
import { demoCode } from "@/app/api/presenter/phone/config";
import { first, nextFlow } from "@/app/api/presenter/phone/flow";

beforeEach(() => vi.stubEnv("AEGIS_PRESENTER_SECRET", "redteam".repeat(8)));
afterEach(() => vi.unstubAllEnvs());

async function menuReply(line: string): Promise<string> {
  const id = "redteam-host-1";
  const menu = await nextFlow(id, first, "", demoCode(id));
  if (!menu.verified) throw new Error("demo PIN didn't verify");
  return (await nextFlow(id, menu, "", line)).reply;
}

describe("red team: the presenter menu still verifies with the demo PIN (harness check)", () => {
  it("reaches the menu", async () => {
    const id = "redteam-host-1";
    expect((await nextFlow(id, first, "", demoCode(id))).phase).toBe("menu");
  });
});

describe("red team, closed breaks: RT-HOST-1 (the presenter flow runs checkCallerLine first)", () => {
  it.each([
    ["crisis", "I want to kill myself.", CRISIS_SCRIPT],
    ["overdose", "I swallowed the whole bottle and I took too many pills.", EMERGENCY_SCRIPT],
    ["breathing", "I can't breathe.", EMERGENCY_SCRIPT],
    ["handover", "Can I talk to a pharmacist?", HANDOVER_SCRIPT],
  ])("RT-HOST-1 %s: %s", async (_kind, line, script) => {
    expect(await menuReply(line)).toContain(script);
  });
});
