import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gateRun, newestSuite, parseLint, parseTests, readGateRuns, summariseHammer, type GateCheck } from "./gate";

// AUDIT #9 (Trail #78): the release gate's one command, and reading what it saved.
const check = (name: string, passed: boolean, required = true): GateCheck => ({ name, passed, required, detail: "", ms: 1 });

describe("release gate", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "gate-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("reads vitest's summary line", () => {
    expect(parseTests(" Test Files  116 passed | 7 skipped (123)\n      Tests  907 passed | 1 expected fail | 10 skipped (918)\n")).toEqual({ passed: 907, failed: 0, skipped: 10 });
    expect(parseTests("      Tests  1 failed | 893 passed | 10 skipped (905)")).toEqual({ passed: 893, failed: 1, skipped: 10 });
    expect(parseTests("no summary")).toBeNull();
  });

  it("reads eslint's problem count", () => {
    expect(parseLint("✖ 1 problem (0 errors, 1 warning)")).toEqual({ errors: 0, warnings: 1 });
    expect(parseLint("✖ 3 problems (2 errors, 1 warning)")).toEqual({ errors: 2, warnings: 1 });
    expect(parseLint("")).toEqual({ errors: 0, warnings: 0 });
  });

  it("sums the hammer's reports", () => {
    const file = { ranAt: "2026-11-22T03:00:00.000Z", reports: [{ sequences: 10, presses: 20, broken: 0 }, { sequences: 5, presses: 7, broken: 1 }] };
    expect(summariseHammer(file)).toEqual({ ranAt: file.ranAt, sequences: 15, presses: 27, broken: 1 });
    expect(summariseHammer({})).toBeNull();
  });

  it("passes only when every required check passes; information checks don't decide it", () => {
    const base = { ranAt: "t", commit: "c", branch: "main", dirty: false, ms: 1 };
    expect(gateRun({ ...base, checks: [check("Tests", true), check("Suite", false, false)] }).passed).toBe(true);
    expect(gateRun({ ...base, checks: [check("Tests", false), check("Build", true)] }).passed).toBe(false);
  });

  it("lists saved runs newest first and skips files that aren't runs", () => {
    const dir = tmp();
    const run = (ranAt: string, passed: boolean) => ({ ranAt, passed, commit: "abc", branch: "main", dirty: false, checks: [], ms: 1 });
    writeFileSync(join(dir, "a.json"), JSON.stringify(run("2026-11-22T01:00:00Z", false)));
    writeFileSync(join(dir, "b.json"), JSON.stringify(run("2026-11-22T02:00:00Z", true)));
    writeFileSync(join(dir, "junk.json"), "{not json");
    writeFileSync(join(dir, "other.json"), JSON.stringify({ hello: 1 }));
    expect(readGateRuns(dir).map((r) => r.ranAt)).toEqual(["2026-11-22T02:00:00Z", "2026-11-22T01:00:00Z"]);
    expect(readGateRuns(join(dir, "missing"))).toEqual([]);
  });

  it("finds the newest saved scenario-suite scoreboard, or none", () => {
    const root = tmp();
    expect(newestSuite(root)).toBeNull();
    mkdirSync(join(root, "arena", "scenarios", "r1"), { recursive: true });
    writeFileSync(join(root, "arena", "scenarios", "r1", "scoreboard.json"), JSON.stringify({ passed: 26, totalScenarios: 28, completed: true, broken: 0 }));
    expect(newestSuite(root)).toMatchObject({ passed: 26, scenarios: 28, completed: true, broken: 0 });
  });
});
