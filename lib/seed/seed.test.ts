import { describe, expect, it } from "vitest";
import { DEMO_NOW, IDS, SEED } from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;
const rx = (id: string) => {
  const found = SEED.prescriptions.find((r) => r.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const daysSince = (iso: string) => (Date.parse(DEMO_NOW) - Date.parse(iso)) / DAY_MS;

describe("seed", () => {
  it("has 8 patients with made-up 555-01xx phones and unique ids", () => {
    expect(SEED.patients).toHaveLength(8);
    for (const p of SEED.patients) expect(p.phone).toMatch(/^555-01\d\d$/);
    expect(new Set(SEED.patients.map((p) => p.id)).size).toBe(8);
    expect(new Set(SEED.prescriptions.map((r) => r.id)).size).toBe(SEED.prescriptions.length);
    expect(new Set(SEED.prescriptions.map((r) => r.rxNumber)).size).toBe(SEED.prescriptions.length);
  });

  it("demo clock is Tuesday 10 AM", () => {
    const d = new Date(DEMO_NOW);
    expect(d.getUTCDay()).toBe(2);
    expect(d.getUTCHours()).toBe(15); // 10 AM at UTC-5
  });

  it("Sam: controlled Concerta, refill 1 of 2, filled 27 days ago, passes rules 3 and 4b", () => {
    const c = rx(IDS.samConcerta);
    expect(c.patientId).toBe(IDS.sam);
    expect(c.controlled).toBe(true);
    expect([c.refillsLeft, c.refillsTotal]).toEqual([2, 2]);
    expect(daysSince(c.lastFill)).toBe(27);
    expect((27 / c.daysSupplied) * 100).toBeGreaterThanOrEqual(80);
    expect(27).toBeGreaterThanOrEqual(c.prescribedIntervalDays - SEED.policy.controlledEarlyWindowDays);
    // Runs out on Friday.
    expect(new Date(Date.parse(c.lastFill) + c.daysSupplied * DAY_MS).getUTCDay()).toBe(5);
    expect(rx(IDS.samMetformin).controlled).toBe(false);
  });

  it("each other patient exercises its rule", () => {
    const p2 = rx(IDS.p2Atorvastatin);
    expect((daysSince(p2.lastFill) / p2.daysSupplied) * 100).toBeLessThan(80); // rule 3
    expect(Date.parse(rx(IDS.p3Lisinopril).expiry)).toBeLessThan(Date.parse(DEMO_NOW)); // rule 2a
    const p4 = rx(IDS.p4Adderall);
    expect(p4.controlled).toBe(true);
    expect(daysSince(p4.lastFill)).toBeLessThan(p4.prescribedIntervalDays - 3); // rule 4b
    const p5 = rx(IDS.p5Levothyroxine);
    expect(daysSince(p5.lastFill) - p5.daysSupplied).toBeGreaterThan(7); // rule 6
    expect(SEED.patients.find((p) => p.id === IDS.p6)?.optedInToCalls).toBe(false); // rule 7
    expect(SEED.patients.find((p) => p.id === IDS.p7)?.addresses).toHaveLength(2); // rule 5
    const p8 = SEED.patients.find((p) => p.id === IDS.p8);
    const p5p = SEED.patients.find((p) => p.id === IDS.p5);
    expect(p8?.phone).toBe(p5p?.phone); // spouse on the same phone
    expect(p8?.householdPatientIds).toContain(IDS.p5);
  });

  it("every prescription and order points at a real patient", () => {
    const ids = new Set(SEED.patients.map((p) => p.id));
    for (const r of SEED.prescriptions) expect(ids.has(r.patientId)).toBe(true);
    for (const o of SEED.orders) expect(ids.has(o.patientId)).toBe(true);
  });
});
