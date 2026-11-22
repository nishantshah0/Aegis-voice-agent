import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAndSave } from "@/lib/sim";
import { loadOutreach, SIM_COMMAND } from "./data";

// The Outreach viewer only shows saved simulation runs (Trail #67).
describe("Outreach data", () => {
  let dir = "";
  const before = process.env.RESULTS_DIR;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "outreach-"));
    process.env.RESULTS_DIR = dir;
  });
  afterEach(async () => {
    if (before === undefined) delete process.env.RESULTS_DIR;
    else process.env.RESULTS_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

  it("says there's no run yet, and how to make one", async () => {
    expect(await loadOutreach()).toEqual({ state: "none", runs: [], command: SIM_COMMAND });
  });

  it("reads the newest run, labelled simulated, with one row per prescription", async () => {
    await runAndSave({ runId: "a", populationSize: 12, days: 6 }, join(dir, "sim"));
    const load = await loadOutreach();
    expect(load.state).toBe("ok");
    if (load.state !== "ok") return;
    expect(load.data.summary.simulated).toBe(true);
    expect(load.data.days).toHaveLength(6);
    expect(load.data.rows.length).toBe(load.data.summary.totals.prescriptions);
    const row = load.data.rows[0];
    expect(row.history.length).toBeGreaterThan(0);
    expect(row.windowCalls.every((c) => c.rxId === row.rxId)).toBe(true);
    expect(load.data.days.reduce((s, d) => s + d.calls, 0)).toBe(load.data.summary.totals.calls);
  });

  it("reports a run it can't read instead of inventing one", async () => {
    await runAndSave({ runId: "a", populationSize: 5, days: 2 }, join(dir, "sim"));
    expect(await loadOutreach("nope")).toMatchObject({ state: "missing", runId: "nope" });
  });
});
