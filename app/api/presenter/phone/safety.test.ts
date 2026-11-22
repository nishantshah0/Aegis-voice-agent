import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRISIS_SCRIPT, EMERGENCY_SCRIPT, HANDOVER_SCRIPT } from "@/lib/guard";
import { SEED } from "@/lib/seed";
import { getStore } from "@/lib/store/memory";
import { demoCode } from "./config";
import { first, nextFlow } from "./flow";

// RT-HOST-1 (Trail #70): every caller line on the presenter's scripted menu goes through
// checkCallerLine first, before the PIN too, and its script wins over the menu. The line is
// flagged on the dashboard's store, so a pharmacist sees it in Today's queue.

const id = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
beforeEach(async () => {
  vi.stubEnv("AEGIS_PRESENTER_SECRET", "s".repeat(48));
  await getStore().reset(SEED);
});
afterEach(() => vi.unstubAllEnvs());

describe("the presenter menu runs the safety check first", () => {
  it("before the PIN: an emergency gets the 911 script and the call ends", async () => {
    const next = await nextFlow(id, first, "", "I can't breathe");
    expect(next.reply).toBe(EMERGENCY_SCRIPT);
    expect(next.phase).toBe("end");
  });

  it("after the PIN: crisis, overdose and handover scripts beat the menu, and each is flagged", async () => {
    const menu = await nextFlow(id, first, "", demoCode(id));
    expect(menu.phase).toBe("menu");
    const crisis = await nextFlow(id, menu, "", "I want to kill myself.");
    expect(crisis.reply).toBe(CRISIS_SCRIPT);
    expect(crisis.phase).not.toBe("end"); // stay on the line with them
    expect((await nextFlow(id, menu, "", "I swallowed the whole bottle and I took too many pills.")).reply).toBe(EMERGENCY_SCRIPT);
    const human = await nextFlow(id, menu, "", "Can I talk to a pharmacist?");
    expect(human.reply).toBe(HANDOVER_SCRIPT);
    expect(human.phase).toBe("end");
    const queue = await getStore().queue();
    expect(queue.filter((q) => q.kind === "escalation" && q.signals.includes("safety_words"))).toHaveLength(4);
  });

  it("leaves ordinary lines and keypad digits to the menu", async () => {
    const menu = await nextFlow(id, first, "", demoCode(id));
    expect((await nextFlow(id, menu, "1", "")).reply).not.toBe(EMERGENCY_SCRIPT);
    expect((await nextFlow(id, menu, "", "history")).phase).toBe("menu");
  });
});
