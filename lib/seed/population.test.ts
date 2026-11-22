import { describe, expect, it } from "vitest";
import { DEMO_NOW, SEED } from "./index";
import { ADHERENCE_PATTERNS, generatePopulation } from "./population";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("simulated population (Trail #67)", () => {
  const pop = generatePopulation();

  it("is the same every run for the same seed, and different for another seed", () => {
    expect(generatePopulation()).toEqual(pop);
    expect(generatePopulation({ seed: 7 })).not.toEqual(pop);
  });

  it("is labelled simulated and has about 240 made-up patients", () => {
    expect(pop.simulated).toBe(true);
    expect(pop.patients).toHaveLength(240);
    expect(pop.asOf).toBe(DEMO_NOW);
    expect(new Set(pop.patients.map((p) => p.patient.id)).size).toBe(240);
  });

  it("only uses 555-01xx phone numbers", () => {
    for (const p of pop.patients) expect(p.patient.phone).toMatch(/^555-01\d\d$/);
  });

  it("never reuses a demo seed id or person, and leaves SEED alone", () => {
    const before = JSON.stringify(SEED);
    generatePopulation({ size: 50 });
    expect(JSON.stringify(SEED)).toBe(before);
    const seedIds = new Set([...SEED.patients.map((p) => p.id), ...SEED.prescriptions.map((r) => r.id)]);
    for (const p of pop.patients) {
      expect(seedIds.has(p.patient.id)).toBe(false);
      for (const rx of p.prescriptions) expect(seedIds.has(rx.id)).toBe(false);
      expect(`${p.patient.firstName} ${p.patient.lastName}`).not.toBe("Sam Rivera");
    }
  });

  it("has every adherence pattern, controlled and non-controlled drugs, and some not opted in", () => {
    for (const pattern of ADHERENCE_PATTERNS) expect(pop.patients.some((p) => p.pattern === pattern)).toBe(true);
    const rxs = pop.patients.flatMap((p) => p.prescriptions);
    expect(rxs.some((r) => r.controlled)).toBe(true);
    expect(rxs.some((r) => !r.controlled)).toBe(true);
    expect(pop.patients.some((p) => !p.patient.optedInToCalls)).toBe(true);
  });

  it("gives each prescription about 12 months of history, oldest first, with real days' supply", () => {
    const asOf = Date.parse(pop.asOf);
    for (const p of pop.patients) {
      for (const rx of p.prescriptions) {
        expect([30, 90]).toContain(rx.daysSupplied);
        const events = p.history[rx.id];
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(Date.parse(e.dueAt)).toBeGreaterThanOrEqual(asOf - 400 * DAY_MS);
        const times = events.map((e) => Date.parse(e.dueAt));
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      }
    }
  });

  it("makes chronic skippers skip more than steady patients", () => {
    const skipRate = (pattern: string) => {
      const events = pop.patients.filter((p) => p.pattern === pattern).flatMap((p) => Object.values(p.history).flat());
      return events.filter((e) => e.status === "skipped").length / events.length;
    };
    expect(skipRate("chronic_skipper")).toBeGreaterThan(skipRate("steady") * 4);
  });

  it("has recently lapsed patients already out of supply", () => {
    const asOf = Date.parse(pop.asOf);
    for (const p of pop.patients.filter((x) => x.pattern === "recently_lapsed")) {
      for (const rx of p.prescriptions) expect(Date.parse(rx.lastFill) + rx.daysSupplied * DAY_MS).toBeLessThan(asOf);
    }
  });

  it("gives no past calls to patients who aren't opted in", () => {
    for (const p of pop.patients.filter((x) => !x.patient.optedInToCalls)) expect(p.pastCalls).toEqual([]);
  });

  it("refuses silly sizes", () => {
    expect(() => generatePopulation({ size: 0 })).toThrow();
    expect(() => generatePopulation({ size: 5000 })).toThrow();
  });
});
