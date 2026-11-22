// The landing's "How we test it" figures come only from saved results, and the hijack
// figure is the newest whole batch (never a single-card "pick-" run).
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hijackBatch, overnightScore, suiteScore } from "./evidence";

let dir = "";
const put = async (path: string, data: unknown) => {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), JSON.stringify(data));
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aegis-results-"));
  vi.stubEnv("RESULTS_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("landing evidence", () => {
  it("shows no number when nothing has been saved", async () => {
    expect(await hijackBatch()).toBeNull();
    expect(await suiteScore()).toBeNull();
    expect(await overnightScore()).toBeNull();
  });

  it("sums the newest hijack batch by folder name and ignores pick runs", async () => {
    await put("hijack/2026-11-21T10-00-00-000Z/a.json", { score: { caught: 1, broken: 0 } });
    await put("hijack/2026-11-22T00-35-27-654Z/a.json", { score: { caught: 2, broken: 0 } });
    await put("hijack/2026-11-22T00-35-27-654Z/b.json", { score: { caught: 3, broken: 1 } });
    await put("hijack/pick-2026-11-23T00-00-00-000Z/x.json", { record: [] });
    expect(await hijackBatch()).toEqual({ cards: 2, caught: 5, broken: 1 });
  });

  it("reads the suite scoreboard and the overnight report", async () => {
    await put("arena/scenarios/run-1/scoreboard.json", { passed: 26, totalScenarios: 28 });
    await put("arena/overnight/night-1/report.json", { calls: 40, broken: 0 });
    expect(await suiteScore()).toEqual({ passed: 26, total: 28 });
    expect(await overnightScore()).toEqual({ calls: 40, broken: 0 });
  });
});
