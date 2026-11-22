import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, RunDailyCheckResponse } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { DEMO_NOW, IDS, SEED } from "@/lib/seed";
import { findBrokenLink } from "@/lib/store/memory";
import { DEMO_HISTORY_SOURCE, HISTORY_APPROVER, historyCallIds } from "./_lib/demo-history";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { GET as historyStatus, POST as seedHistory } from "./demo/history/route";
import { POST as resetDemo } from "./demo/reset/route";
import { POST as runDailyCheck } from "./outbound/run-daily-check/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  session.approver = PHARMACIST;
  resetBusForTests();
  await resetRuntimeForTests();
});
afterEach(() => vi.unstubAllEnvs());

async function seed() {
  const res = await seedHistory();
  expect(res.status).toBe(200);
  return (await res.json()) as { seeded: boolean; calls: number; lanes: Record<string, number>; caught: number };
}

// Seeding runs about 40 calls through the real lock: about a second alone, more under a loaded gate.
describe("POST /api/demo/history: seed a week of scripted calls", { timeout: 30_000 }, () => {
  it("needs the demo controls: a signed-in pharmacist or reviewer, or DEMO_CONTROLS=on", async () => {
    session.approver = null;
    expect((await seedHistory()).status).toBe(401);
    expect((await historyStatus()).status).toBe(401);
    expect(historyCallIds(await getStore().listRecord()).size).toBe(0);
  });

  it("runs about 40 calls over the 7 days before the demo clock, each marked as scripted, and puts the clock back", async () => {
    const summary = await seed();
    const store = getStore();
    expect(summary.seeded).toBe(true);
    expect(summary.calls).toBeGreaterThanOrEqual(35);
    expect(summary.calls).toBeLessThanOrEqual(45);
    expect(await store.now()).toBe(DEMO_NOW);

    const record = await store.listRecord();
    const ids = historyCallIds(record);
    expect(ids.size).toBe(summary.calls);
    const days = new Set<string>();
    for (const id of ids) {
      const call = (await store.getCall(id))!;
      expect(call.state).toBe("ended");
      const ago = (Date.parse(DEMO_NOW) - Date.parse(call.startedAt)) / DAY_MS;
      expect(ago).toBeGreaterThan(0);
      expect(ago).toBeLessThanOrEqual(8);
      days.add(new Date(Date.parse(call.startedAt) - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)); // the pharmacy's calendar day
      const marker = record.find((e) => e.callId === id && (e.input as { check?: string })?.check === "demo_history");
      expect(marker?.input).toMatchObject({ source: DEMO_HISTORY_SOURCE });
    }
    expect(days.size).toBe(7);
    expect([...days].every((d) => d < DEMO_NOW.slice(0, 10))).toBe(true);
  });

  it("goes through the real lock and the record: buttons pressed, lines guarded, chain verified", async () => {
    await seed();
    const record = await getStore().listRecord();
    expect(findBrokenLink(record)).toBeNull();
    const ids = historyCallIds(record);
    const mine = record.filter((e) => e.callId && ids.has(e.callId));
    expect(mine.filter((e) => e.kind === "button").length).toBeGreaterThan(80);
    expect(mine.filter((e) => e.kind === "line_spoken").length).toBeGreaterThan(80);
    expect(mine.filter((e) => e.kind === "caller_line").length).toBeGreaterThan(80);
    // The lock refused what it should: an expired prescription, early controlled refills, labels before ID.
    const refusedRules = new Set(mine.filter((e) => e.kind === "button" && e.decision === "blocked").flatMap((e) => e.ruleIds ?? []));
    for (const rule of ["1", "2a", "4b"]) expect(refusedRules).toContain(rule);
    // The scripted compromised AI's lies were struck by the speech guard.
    expect(mine.filter((e) => e.kind === "line_blocked").length).toBeGreaterThanOrEqual(4);
  });

  it("spreads the queue across all three lanes, and the scripted pharmacist has decided everything that needed a person", async () => {
    const summary = await seed();
    expect(summary.lanes.automatic).toBeGreaterThan(0);
    expect(summary.lanes.quick_check).toBeGreaterThan(0);
    expect(summary.lanes.review).toBeGreaterThan(0);
    const ids = historyCallIds(await getStore().listRecord());
    const items = (await getStore().queue()).filter((q) => ids.has(q.callId));
    const staffed = items.filter((q) => q.lane !== "automatic");
    expect(staffed.every((q) => q.status !== "open")).toBe(true);
    expect(staffed.every((q) => q.decidedBy?.id === HISTORY_APPROVER.id)).toBe(true);
    expect(staffed.some((q) => q.status === "denied")).toBe(true);
    expect(items.some((q) => q.notes.some((n) => n.kind === "side_effect"))).toBe(true);
  });

  it("never touches Sam: no history call is his, and his prescriptions have no new orders", async () => {
    await seed();
    const store = getStore();
    for (const id of historyCallIds(await store.listRecord())) {
      const call = (await store.getCall(id))!;
      expect(call.lockedPatientId).not.toBe(IDS.sam);
      expect(call.targetPatientId).not.toBe(IDS.sam);
    }
    expect(await store.listOrders(IDS.sam)).toEqual(SEED.orders.filter((o) => o.patientId === IDS.sam));
  });

  it("is idempotent: seeding again runs nothing", async () => {
    const first = await seed();
    const length = (await getStore().listRecord()).length;
    const again = await seed();
    expect(again.seeded).toBe(false);
    expect(again.calls).toBe(first.calls);
    expect((await getStore().listRecord()).length).toBe(length);
    expect(await (await historyStatus()).json()).toMatchObject({ seeded: false, calls: first.calls });
  });

  it("Reset demo clears it, and the demo still works after seeding: the daily check rings Sam, and his call is the newest", async () => {
    await seed();
    expect((await resetDemo()).status).toBe(200);
    expect(historyCallIds(await getStore().listRecord()).size).toBe(0);

    await seed();
    const rung = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    const store = getStore();
    const calls = await Promise.all(rung.callIds.map((id) => store.getCall(id)));
    expect(calls.map((c) => c?.targetPatientId)).toContain(IDS.sam);
    const newest = (await store.listRecord()).filter((e) => (e.input as { check?: string })?.check === "call_start").at(-1)!;
    expect(rung.callIds).toContain(newest.callId);
    const history = historyCallIds(await store.listRecord());
    for (const id of rung.callIds) expect(history.has(id)).toBe(false);
  });
});
