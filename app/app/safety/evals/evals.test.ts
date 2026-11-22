import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readEvals } from "./evals";

// The Evals page reads only what real runs saved under results/. These files are fixtures
// in a temp folder, shaped like the files each run writes.

async function put(path: string, json: unknown, mtime?: number) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(json));
  if (mtime) await utimes(path, new Date(mtime), new Date(mtime));
}

const card = (cardId: string, caught: number, broken = 0) => ({ cardId, callId: "c_0001", record: [], score: { automatedPassed: broken === 0, caught, broken, checks: [] } });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "evals-"));
  await put(join(dir, "hammer-latest.json"), {
    ranAt: "2026-11-21T12:50:26.164Z",
    depth: 3,
    reports: [
      { kind: "exhaustive", sequences: 100, presses: 300, checks: 400, broken: 0, failures: [] },
      { kind: "random", sequences: 10, presses: 50, checks: 60, broken: 0, failures: [] },
    ],
  });
  await put(join(dir, "hijack", "b1", "early_refill.json"), card("early_refill", 3), 1_000_000);
  await put(join(dir, "hijack", "b2", "early_refill.json"), card("early_refill", 4), 2_000_000);
  await put(join(dir, "hijack", "b2", "cross_patient.json"), card("cross_patient", 2), 2_000_000);
  await put(join(dir, "hijack", "pick-x", "hijack_pick_1_early_refill.json"), { tag: "x", record: [] }, 3_000_000);
  const board = (passed: number, broken: number) => ({
    totalScenarios: 28,
    completed: true,
    passed,
    caught: 5,
    broken,
    scenarios: [{ id: "copay", group: "ordinary_patients", passed: true, attempts: [{ callId: "c_1", automatedPassed: true, caught: 1, broken: 0, checks: [] }, { callId: "c_2", automatedPassed: true, caught: 0, broken: 0, checks: [] }] }],
  });
  await put(join(dir, "arena", "scenarios", "r1", "scoreboard.json"), board(20, 1), 1_000_000);
  await put(join(dir, "arena", "scenarios", "r2", "scoreboard.json"), board(26, 0), 2_000_000);
  await put(join(dir, "arena", "overnight", "o1", "report.json"), { ranAt: "2026-11-22T01:01:24.688Z", calls: 10, caught: 11, broken: 0, gaps: [{ scenario: "x", summary: "y", fix: { status: "fixed" } }] });
  await put(join(dir, "arena", "live", "20261122020000-abc123.json"), {
    id: "20261122020000-abc123",
    title: "90 Adderall, today",
    source: { kind: "card", id: "early_refill" },
    state: "ended",
    startedAt: "2026-11-22T02:00:00.000Z",
    endedAt: "2026-11-22T02:01:00.000Z",
    turns: [],
    verdict: { caught: 3, broken: [], recordVerified: true },
  });
  return dir;
}

describe("the Evals page's numbers", () => {
  it("reads each layer's latest saved run, with its history for the sparkline", async () => {
    const e = await readEvals(await fixture());

    expect(e.layers.hammer.latest).toMatchObject({ broken: 0, at: "2026-11-21T12:50:26.164Z" });
    expect(e.layers.hammer.latest?.figures).toEqual(expect.arrayContaining([["Sequences", 110], ["Presses", 350], ["Invariant checks", 460]]));

    // Full batches only, oldest first: the stage pick is one attack, not a batch.
    expect(e.layers.hijack.runs).toBe(2);
    expect(e.layers.hijack.history.map((p) => p.value)).toEqual([3, 6]);
    expect(e.layers.hijack.latest).toMatchObject({ broken: 0, caught: 6, calls: 2 });

    expect(e.layers.scenarios.history.map((p) => p.value)).toEqual([20, 26]);
    expect(e.layers.scenarios.latest).toMatchObject({ broken: 0, calls: 2 });

    expect(e.layers.overnight.latest).toMatchObject({ broken: 0, caught: 11, calls: 10 });
    expect(e.layers.live.latest).toMatchObject({ broken: 0, caught: 3, calls: 1 });
    expect(e.layers.live.latest?.href).toBe("/app/safety/calls/20261122020000-abc123");
  });

  it("adds every layer into one hero: rules broken, calls made, presses tested", async () => {
    const e = await readEvals(await fixture());
    expect(e.hero).toEqual({ broken: 0, calls: 2 + 2 + 10 + 1, presses: 350, layers: 5 });
  });

  it("says 'no run yet' for a layer with nothing saved, never a made-up number", async () => {
    const e = await readEvals(await mkdtemp(join(tmpdir(), "evals-empty-")));
    for (const layer of Object.values(e.layers)) {
      expect(layer.latest).toBeNull();
      expect(layer.runs).toBe(0);
    }
    expect(e.hero).toEqual({ broken: null, calls: 0, presses: 0, layers: 0 });
  });

  it("counts a broken rule from any layer in the hero", async () => {
    const dir = await fixture();
    await put(join(dir, "arena", "scenarios", "r3", "scoreboard.json"), { totalScenarios: 28, completed: true, passed: 25, caught: 5, broken: 2, scenarios: [] }, 3_000_000);
    expect((await readEvals(dir)).hero.broken).toBe(2);
  });

  it("orders hijack batches by the time in their folder name, since a fresh checkout gives every file the same time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evals-order-"));
    const same = 5_000_000;
    await put(join(dir, "hijack", "2026-11-22T00-08-58-709Z", "early_refill.json"), card("early_refill", 9), same);
    await put(join(dir, "hijack", "2026-11-21T11-22-05-794Z", "early_refill.json"), card("early_refill", 2), same);
    await put(join(dir, "hijack", "pick-2026-11-22T01-00-00-000Z", "hijack_pick_1_early_refill.json"), { tag: "x", record: [] }, same);
    const e = await readEvals(dir);
    expect(e.layers.hijack.history.map((p) => p.value)).toEqual([2, 9]);
    expect(e.layers.hijack.latest).toMatchObject({ caught: 9, path: "results/hijack/2026-11-22T00-08-58-709Z" });
  });
});
