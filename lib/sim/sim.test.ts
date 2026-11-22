import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { refillPreview } from "@/app/api/_lib/outbound";
import { SEED } from "@/lib/seed";
import { generatePopulation, type Population } from "@/lib/seed/population";
import { createMemoryStore, getStore } from "@/lib/store/memory";
import { listRuns, readRun, runAndSave, runSim } from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A small population with one prescription bent into a known state. */
function bent(change: (p: Population["patients"][number]) => void, size = 6): Population {
  const pop = structuredClone(generatePopulation({ size }));
  change(pop.patients[0]);
  return pop;
}

/** Make patient 0's first prescription run out `left` days after the sim starts. */
function dueIn(p: Population["patients"][number], left: number, asOf: string) {
  const rx = p.prescriptions[0];
  rx.lastFill = new Date(Date.parse(asOf) - (rx.daysSupplied - left) * DAY_MS).toISOString();
  p.prescriptions = [rx];
}

describe("outreach simulation (Trail #67)", () => {
  it("is the same for the same seeds (apart from when it ran)", async () => {
    const a = await runSim({ populationSize: 40, days: 10 });
    const b = await runSim({ populationSize: 40, days: 10 });
    expect({ ...b.summary, ranAt: "" }).toEqual({ ...a.summary, ranAt: "" });
    expect(b.days).toEqual(a.days);
    expect(b.forecast).toEqual(a.forecast);
  });

  it("labels every run simulated and plays the asked number of days", async () => {
    const run = await runSim({ populationSize: 20, days: 30 });
    expect(run.summary.simulated).toBe(true);
    expect(run.days).toHaveLength(30);
    expect(run.days[0].date).toBe("2026-11-24");
    expect(run.days[29].date).toBe("2026-12-23");
    expect(run.summary.sources.real.length).toBeGreaterThan(0);
    expect(run.summary.sources.model.length).toBeGreaterThan(0);
  });

  it("never touches the live store or the seed", async () => {
    const live = getStore();
    const before = { record: (await live.listRecord()).length, now: await live.now(), seed: JSON.stringify(SEED) };
    await runSim({ populationSize: 30, days: 10 });
    expect((await live.listRecord()).length).toBe(before.record);
    expect(await live.now()).toBe(before.now);
    expect(JSON.stringify(SEED)).toBe(before.seed);
  });

  it("rings a patient whose supply runs out within 3 days, with the lane the real rules give", async () => {
    const pop = bent((p) => {
      p.patient.optedInToCalls = true;
      dueIn(p, 2, SEED.now);
      Object.assign(p.prescriptions[0], { controlled: false, refillsLeft: 3, expiry: "2027-06-01T00:00:00Z" });
    });
    const run = await runSim({ days: 1, earlyReach: false }, pop);
    const call = run.days[0].calls.find((c) => c.patientId === pop.patients[0].patient.id);
    expect(call?.source).toBe("daily_check");
    // The lane is the real refillPreview's on a store holding this prescription at that time.
    const store = createMemoryStore({ ...SEED, patients: [pop.patients[0].patient], prescriptions: pop.patients[0].prescriptions });
    await store.setNow(call!.at);
    const preview = await refillPreview(store, pop.patients[0].patient, pop.patients[0].prescriptions[0]);
    expect(preview).toMatchObject({ kind: "lane", lane: call!.lane });
  });

  it("puts a due controlled drug in Quick check (rule 4) and holds a refill with none left (rule 2b)", async () => {
    const pop = bent((p) => {
      p.patient.optedInToCalls = true;
      dueIn(p, 1, SEED.now);
      Object.assign(p.prescriptions[0], { controlled: true, drugClass: "stimulant", refillsLeft: 2, expiry: "2027-06-01T00:00:00Z" });
    });
    pop.patients[1].patient.optedInToCalls = true;
    dueIn(pop.patients[1], 1, SEED.now);
    Object.assign(pop.patients[1].prescriptions[0], { refillsLeft: 0, expiry: "2027-06-01T00:00:00Z" });

    const run = await runSim({ days: 1, earlyReach: false }, pop);
    const controlled = run.days[0].calls.find((c) => c.patientId === pop.patients[0].patient.id);
    expect(controlled).toMatchObject({ lane: "quick_check", ruleIds: ["4"] });
    const held = run.days[0].held.find((h) => h.patientId === pop.patients[1].patient.id);
    expect(held).toMatchObject({ by: "refill_rules", ruleIds: ["2b"] });
    expect(run.days[0].calls.some((c) => c.patientId === pop.patients[1].patient.id)).toBe(false);
  });

  it("doesn't ring patients who aren't opted in (rule 7a)", async () => {
    const pop = bent((p) => {
      p.patient.optedInToCalls = false;
      dueIn(p, 0, SEED.now);
      Object.assign(p.prescriptions[0], { refillsLeft: 3, expiry: "2027-06-01T00:00:00Z" });
    });
    const run = await runSim({ days: 3 }, pop);
    const id = pop.patients[0].patient.id;
    expect(run.days.flatMap((d) => d.calls).some((c) => c.patientId === id)).toBe(false);
    expect(run.days[0].held.find((h) => h.patientId === id)).toMatchObject({ by: "rule_7", ruleIds: ["7a"] });
    expect(run.forecast.find((f) => f.patientId === id)?.noCallWhy).toContain("7a");
  });

  it("never rings the same prescription twice within 3 days (rule 7d, from the real cards)", { timeout: 60_000 }, async () => {
    const run = await runSim({ populationSize: 120, days: 30 });
    const byRx = new Map<string, number[]>();
    for (const c of run.days.flatMap((d) => d.calls)) byRx.set(c.rxId, [...(byRx.get(c.rxId) ?? []), Date.parse(c.at)]);
    let repeats = 0;
    for (const times of byRx.values()) {
      for (let i = 1; i < times.length; i++) {
        repeats++;
        expect(times[i] - times[i - 1]).toBeGreaterThan(3 * DAY_MS - 12 * 60 * 60 * 1000);
      }
    }
    expect(repeats).toBeGreaterThan(0);
    expect(run.summary.totals.heldByRule["7d"]).toBeGreaterThan(0);
  });

  it("rings high-risk patients early only when early reach is on, and labels it", { timeout: 60_000 }, async () => {
    const on = await runSim({ populationSize: 240, days: 30 });
    const off = await runSim({ populationSize: 240, days: 30, earlyReach: false });
    expect(on.summary.totals.earlyReachCalls).toBeGreaterThan(0);
    expect(off.days.flatMap((d) => d.calls).some((c) => c.source === "early_reach")).toBe(false);
    const early = on.days.flatMap((d) => d.calls).filter((c) => c.source === "early_reach");
    for (const c of early) expect(on.forecast.find((f) => f.rxId === c.rxId)?.risk.band).toBe("high");
    const first = on.forecast.filter((f) => f.nextCall?.source === "early_reach");
    for (const f of first) expect(f.nextCall?.why).toContain("Simulation's model");
    expect(on.summary.sources.model.some((m) => m.startsWith("Early reach"))).toBe(true);
  });

  it("adds up: calls by lane match the calls, and review load counts review refills", async () => {
    const run = await runSim({ populationSize: 80, days: 14 });
    for (const d of run.days) {
      expect(d.callsByLane.automatic + d.callsByLane.quick_check + d.callsByLane.review).toBe(d.calls.length);
      const asked = d.calls.filter((c) => c.outcome === "asked_for_pharmacist").length;
      expect(d.reviewLoad).toBe(asked + d.refills.filter((r) => r.lane === "review").length);
    }
    expect(run.summary.totals.calls).toBe(run.days.reduce((s, d) => s + d.calls.length, 0));
  });

  describe("saved runs", () => {
    let dir = "";
    afterAll(async () => dir && rm(dir, { recursive: true, force: true }));

    it("saves population, days, forecast and summary, and reads them back", async () => {
      dir = await mkdtemp(join(tmpdir(), "sim-"));
      const { path } = await runAndSave({ runId: "t1", populationSize: 15, days: 5 }, dir);
      expect(path).toBe(join(dir, "t1"));
      const runs = await listRuns(dir);
      expect(runs.map((r) => r.runId)).toEqual(["t1"]);
      const saved = await readRun("t1", dir);
      expect(saved?.population.simulated).toBe(true);
      expect(saved?.days).toHaveLength(5);
      expect(saved?.forecast.length).toBeGreaterThan(0);
    });

    it("refuses run ids that could leave the folder", async () => {
      expect(await readRun("../etc", dir)).toBeNull();
      await expect(runAndSave({ runId: "../x" }, dir)).rejects.toThrow();
    });
  });
});
