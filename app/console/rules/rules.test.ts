import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUTTON_NAMES, BUTTON_TIERS, GUARD_REPLACEMENTS, NEEDS_VERIFIED } from "@/lib/contract";
import { INVARIANTS } from "@/scripts/hammer/invariants";
import { readRules } from "./rules";
import { RuleBook } from "./RuleBook";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

let dir: string;
const before = process.env.RESULTS_DIR;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rules-"));
  process.env.RESULTS_DIR = dir;
});
afterEach(async () => {
  if (before === undefined) delete process.env.RESULTS_DIR;
  else process.env.RESULTS_DIR = before;
  await rm(dir, { recursive: true, force: true });
});

const hammer = (failures: unknown[] = []) => ({
  ranAt: "2026-11-21T12:50:26.164Z",
  mode: "hammer",
  depth: 3,
  reports: [
    { kind: "exhaustive", sequences: 40, presses: 90, checks: 120, broken: failures.length, failures, ms: 5 },
    { kind: "random", sequences: 7, presses: 11, checks: 13, broken: 0, failures: [], ms: 5 },
  ],
});

describe("readRules", () => {
  it("lists the 12 buttons from lib/contract in order, with tier and whether they need a verified call", async () => {
    const { buttons } = await readRules(dir);
    expect(buttons.map((b) => b.name)).toEqual([...BUTTON_NAMES]);
    for (const b of buttons) {
      expect(b.tier).toBe(BUTTON_TIERS[b.name]);
      expect(b.needsVerified).toBe(NEEDS_VERIFIED.includes(b.name));
      expect(b.guard.length).toBeGreaterThan(0);
    }
  });

  it("lists S1 to S4 with the contract's fixed replacement lines", async () => {
    const { speech } = await readRules(dir);
    expect(speech.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(speech.find((s) => s.id === "S1")!.replacement).toBe(GUARD_REPLACEMENTS.S1);
    expect(speech.find((s) => s.id === "S4")!.replacement).toBeUndefined();
  });

  it("only maps rules to invariants the hammer really checks", async () => {
    const { buttons, speech } = await readRules(dir);
    for (const row of [...buttons, ...speech]) for (const name of row.invariants) expect(INVARIANTS).toContain(name);
  });

  it("says 'no run yet' with the command when the hammer file is missing", async () => {
    const view = await readRules(dir);
    expect(view.hammer).toMatchObject({ state: "none", command: "npm run hammer" });
    expect(view.buttons.every((b) => b.broken === null)).toBe(true);
  });

  it("counts each rule's saved hammer failures from results/hammer-latest.json", async () => {
    await writeFile(
      join(dir, "hammer-latest.json"),
      JSON.stringify(hammer([{ sequence: ["inbound", "set_delivery foreign"], broken: [{ rule: "delivery to an address not on file", detail: "x" }] }])),
    );
    const view = await readRules(dir);
    expect(view.hammer).toMatchObject({ state: "ok", sequences: 47, checks: 133, broken: 1, ranAt: "2026-11-21T12:50:26.164Z" });
    expect(view.buttons.find((b) => b.name === "set_delivery")!.broken).toBe(1);
    expect(view.buttons.find((b) => b.name === "request_refill")!.broken).toBe(0);
  });
});

describe("Rules page", () => {
  it("shows every button and speech rule, the hammer's real counts, and no control that changes anything", async () => {
    await writeFile(join(dir, "hammer-latest.json"), JSON.stringify(hammer()));
    const html = renderToStaticMarkup(await RuleBook());
    for (const name of BUTTON_NAMES) expect(html).toContain(name);
    for (const id of ["S1", "S2", "S3", "S4"]) expect(html).toContain(id);
    expect(html).toContain("133"); // invariant checks, read from the file
    expect(html).not.toMatch(/<button|<form|<input/);
  });
});
