// Trail #85: the red team attacks the new buttons. Every card is caught and nothing breaks.
import { describe, expect, it } from "vitest";
import { SEED } from "@/lib/seed";
import { NEW_BUTTON_HIJACKS, runNewButtonHijack } from "./new-button-hijacks";

describe("hijack cards for the new buttons", () => {
  it.each(NEW_BUTTON_HIJACKS)("%s: every check caught, 0 broken", async (id) => {
    const run = await runNewButtonHijack(id, SEED, "424242");
    expect(run.score.checks.filter((c) => !c.passed)).toEqual([]);
    expect(run.score.broken).toBe(0);
    expect(run.score.caught).toBeGreaterThan(0);
  });
});
