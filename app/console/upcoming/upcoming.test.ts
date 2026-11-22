import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS, SEED } from "@/lib/seed";
import { getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { POST as runDailyCheck } from "@/app/api/outbound/run-daily-check/route";
import { upcoming } from "./upcoming";

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => ({ id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" as const }),
}));

const DAY = 86_400_000;
const daysLeftOf = (rxId: string) => {
  const rx = SEED.prescriptions.find((r) => r.id === rxId)!;
  return rx.daysSupplied - Math.floor((Date.parse(SEED.now) - Date.parse(rx.lastFill)) / DAY);
};

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

describe("upcoming (2.9a)", () => {
  it("lists prescriptions due within 14 days, soonest first, with Sam's Concerta previewed into Quick check", async () => {
    const { rows } = await upcoming(getStore());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.daysLeft <= 14)).toBe(true);
    expect(rows.map((r) => r.daysLeft)).toEqual([...rows.map((r) => r.daysLeft)].sort((a, b) => a - b));
    expect(rows.length).toBeLessThan(SEED.prescriptions.length);

    const sam = rows.find((r) => r.rxId === IDS.samConcerta)!;
    expect(sam).toMatchObject({ patientId: IDS.sam, initials: "S.R.", drug: "Concerta 36 mg", controlled: true, daysLeft: daysLeftOf(IDS.samConcerta) });
    expect(sam.preview).toMatchObject({ kind: "lane", lane: "quick_check" });
    expect(sam.preview.ruleIds).toContain("4");
    expect(sam.nextReminder).toBe("today");

    const grace = rows.find((r) => r.patientId === IDS.p5)!;
    expect(grace.preview).toMatchObject({ kind: "lane", lane: "review" });

    for (const r of rows) {
      const patient = SEED.patients.find((p) => p.id === r.patientId)!;
      if (!patient.optedInToCalls) expect(r.nextReminder).toBe("not opted in");
    }
  });

  it("is a preview only: building it writes nothing to the record", async () => {
    const before = (await getStore().listRecord()).length;
    await upcoming(getStore());
    expect((await getStore().listRecord()).length).toBe(before);
  });

  it("has a 14-day strip starting today, counting run-outs per day", async () => {
    const { rows, days } = await upcoming(getStore());
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe(SEED.now.slice(0, 10));
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(rows.filter((r) => r.daysLeft >= 0 && r.daysLeft < 14).length);
  });

  it("shows the last call once the daily check has rung", async () => {
    await runDailyCheck();
    const { rows } = await upcoming(getStore());
    const sam = rows.find((r) => r.rxId === IDS.samConcerta)!;
    expect(sam.lastCall).toMatchObject({ direction: "outbound", state: "code_sent" });
  });

  // Audit fix 14: after Sam's call, Upcoming said "Next reminder: today" though rule 7
  // (one call per 3 days) won't let the daily check ring him again.
  it("doesn't promise a reminder today once rule 7 would refuse the call, and still writes nothing", async () => {
    await runDailyCheck();
    const before = (await getStore().listRecord()).length;
    const { rows } = await upcoming(getStore());
    const sam = rows.find((r) => r.rxId === IDS.samConcerta)!;
    expect(sam.nextReminder).not.toBe("today");
    expect(sam.nextReminder).toMatch(/rule 7/);
    expect((await getStore().listRecord()).length).toBe(before);
  });
});
