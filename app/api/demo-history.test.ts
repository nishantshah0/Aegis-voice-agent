import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, RunDailyCheckResponse } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { DEMO_NOW, IDS, SEED } from "@/lib/seed";
import { findBrokenLink } from "@/lib/store/memory";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStore, fromPGlite } from "@/lib/store/postgres";
import { createMemoryStore } from "@/lib/store/memory";
import { seedDemoHistory } from "./_lib/demo-history";
import { DEMO_HISTORY_SOURCE, HISTORY_APPROVER, historyCallIds, todayCallIds } from "./_lib/demo-history";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { GET as historyStatus, POST as seedHistory } from "./demo/history/route";
import { POST as resetDemo } from "./demo/reset/route";
import { POST as runDailyCheck } from "./outbound/run-daily-check/route";
import type { QueueItem, Store } from "@/lib/contract";

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
    const record = await getStore().listRecord();
    const today = todayCallIds(record);
    const ids = new Set([...historyCallIds(record)].filter((id) => !today.has(id)));
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

// Nishant, Sunday: the dashboard opens on a believable live queue. The seed's demo morning
// leaves 5 to 7 items OPEN for a pharmacist, each from a real scripted call through the driver,
// the lock and the guard, and books upcoming appointments through the real offer, question and
// yes. Sam is never in it, so his live call still works.
describe("the demo morning: an open queue and upcoming bookings", { timeout: 60_000 }, () => {
  async function morning(store: Store) {
    const record = await store.listRecord();
    const today = todayCallIds(record);
    const open = (await store.queue()).filter((q) => today.has(q.callId) && q.status === "open");
    return { today, open, record };
  }
  const has = (items: QueueItem[], test: (q: QueueItem) => boolean) => items.some(test);
  const noteText = (q: QueueItem) => q.notes.map((n) => n.text).join(" ").toLowerCase();

  it("leaves 5 to 7 items open for a pharmacist, each for a real reason, across several patients", async () => {
    await seed();
    const store = getStore();
    const { open, today } = await morning(store);
    expect(today.size).toBeGreaterThanOrEqual(6);
    expect(open.length).toBeGreaterThanOrEqual(5);
    expect(open.length).toBeLessThanOrEqual(7);
    expect(open.every((q) => q.lane !== "automatic")).toBe(true);
    // A controlled refill (rule 4), in Quick check.
    expect(has(open, (q) => q.kind === "refill" && q.ruleIds.includes("4") && q.lane === "quick_check")).toBe(true);
    // An early refill (rule 3).
    expect(has(open, (q) => q.kind === "refill" && q.ruleIds.includes("3"))).toBe(true);
    // A renewal.
    expect(has(open, (q) => q.kind === "renewal")).toBe(true);
    // A side effect, in the patient's words, with when and how bad.
    expect(has(open, (q) => q.notes.some((n) => n.kind === "side_effect" && /since|last night|this week/i.test(n.text) && /out of ten|bad|mild|moderate|severe/i.test(n.text)))).toBe(true);
    // Safety-check handovers: a possible small overdose (emergency), a crisis, a request for a pharmacist.
    const safety = open.filter((q) => q.kind === "escalation" && q.signals.includes("safety_words"));
    expect(has(safety, (q) => noteText(q).startsWith("emergency"))).toBe(true);
    expect(has(safety, (q) => noteText(q).startsWith("crisis"))).toBe(true);
    expect(has(safety, (q) => noteText(q).startsWith("handover"))).toBe(true);
    // Spread across patients, never Sam, and every handover is tied to a verified patient.
    expect(new Set(open.map((q) => q.patientId)).size).toBeGreaterThanOrEqual(5);
    expect(open.some((q) => q.patientId === IDS.sam || q.patientId === "unknown")).toBe(false);
  });

  it("happens on the demo day before the demo clock, and is marked scripted demo history", async () => {
    await seed();
    const store = getStore();
    const { today, record } = await morning(store);
    for (const id of today) {
      const call = (await store.getCall(id))!;
      expect(call.startedAt.slice(0, 10)).toBe(new Date(Date.parse(DEMO_NOW)).toISOString().slice(0, 10));
      expect(Date.parse(call.startedAt)).toBeLessThan(Date.parse(DEMO_NOW));
      expect(record.some((e) => e.callId === id && (e.input as { source?: string })?.source === DEMO_HISTORY_SOURCE)).toBe(true);
    }
    expect(await store.now()).toBe(DEMO_NOW);
  });

  it("books 4 to 6 upcoming appointments through the real offer and yes, none for Sam, and leaves a slot free", async () => {
    await seed();
    const store = getStore();
    const booked = await store.listAppointments();
    expect(booked.length).toBeGreaterThanOrEqual(4);
    expect(booked.length).toBeLessThanOrEqual(6);
    expect(booked.some((a) => a.patientId === IDS.sam)).toBe(false);
    expect(new Set(booked.map((a) => a.patientId)).size).toBe(booked.length);
    const slots = (await store.policy()).appointmentSlots ?? [];
    expect(slots.length).toBeGreaterThan(booked.length);
    for (const a of booked) expect(Date.parse(slots.find((s) => s.id === a.slotId)!.start)).toBeGreaterThan(Date.parse(DEMO_NOW));
    // Each booking was confirmed aloud by the guard-checked read-back.
    const spoken = (await store.listRecord()).filter((e) => e.kind === "line_spoken").map((e) => (e.input as { text: string }).text);
    for (const a of booked) expect(spoken.some((t) => t.startsWith("Your pharmacist appointment is booked for") && t.includes(slots.find((s) => s.id === a.slotId)!.label))).toBe(true);
  });

  it("leaves Sam's demo working: no open item or booking for him, and the daily check still rings him", async () => {
    await seed();
    const store = getStore();
    expect((await store.queue()).some((q) => q.patientId === IDS.sam)).toBe(false);
    const rung = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    const calls = await Promise.all(rung.callIds.map((id) => store.getCall(id)));
    expect(calls.map((c) => c?.targetPatientId)).toContain(IDS.sam);
  });

  it("runs the same on the Postgres store the hosted demo uses", async () => {
    const pg = new PGlite();
    const store = createPostgresStore(fromPGlite(pg), SEED);
    await store.reset(SEED);
    await seedDemoHistory(store);
    const { open } = await morning(store);
    expect(open.length).toBeGreaterThanOrEqual(5);
    expect((await store.listAppointments()).length).toBeGreaterThanOrEqual(4);
    expect(findBrokenLink(await store.listRecord())).toBeNull();
    await pg.close();
  });

  it("is still idempotent with the morning added", async () => {
    const first = await seedDemoHistory(createMemoryStore(SEED));
    expect(first.seeded).toBe(true);
  });
});

