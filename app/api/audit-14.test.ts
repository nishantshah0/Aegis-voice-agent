import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, RunDailyCheckResponse, StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS, SEED } from "@/lib/seed";
import { upcoming } from "@/app/console/upcoming/upcoming";
import { issuePhoneToken } from "./_lib/phone";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as resetDemo } from "./demo/reset/route";
import { POST as runDailyCheck } from "./outbound/run-daily-check/route";

// AUDIT fix 14 (daily check and Upcoming): a rung call nobody answers ends as a missed call,
// and a prescription with a refill already on its way isn't rung or reminded about again.

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
const RING_MS = 120_000;

let events: StreamEvent[] = [];
beforeEach(async () => {
  session.approver = PHARMACIST;
  resetBusForTests();
  await resetRuntimeForTests();
  events = [];
  subscribe((d) => events.push(d.event));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  resetBusForTests();
});

const dailyCheck = async () => (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
const callFor = async (callIds: string[], patientId: string) => {
  for (const id of callIds) {
    const call = await getStore().getCall(id);
    if (call?.targetPatientId === patientId) return call;
  }
  throw new Error(`no call for ${patientId}`);
};

describe("a rung call nobody answers (AUDIT 14)", () => {
  it("ends as a missed call after the ring time, with a no_answer entry and a phone status", async () => {
    const { callIds } = await dailyCheck();
    const grace = await callFor(callIds, IDS.p5);
    await vi.advanceTimersByTimeAsync(RING_MS - 1_000);
    expect((await getStore().getCall(grace.id))?.state).not.toBe("ended");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await getStore().getCall(grace.id))?.state).toBe("ended");
    const record = await getStore().listRecord(grace.id);
    expect(record.at(-1)).toMatchObject({ kind: "safety", actor: "system", input: { check: "no_answer" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "phone", callId: grace.id, kind: "status" }));
  });

  it("leaves an answered call alone", async () => {
    const { callIds } = await dailyCheck();
    const sam = await callFor(callIds, IDS.sam);
    expect(issuePhoneToken(sam.id)).toBeTruthy(); // Sam's phone picked up
    await vi.advanceTimersByTimeAsync(RING_MS * 2);
    expect((await getStore().getCall(sam.id))?.state).not.toBe("ended");
    expect((await getStore().listRecord(sam.id)).some((e) => (e.input as { check?: string })?.check === "no_answer")).toBe(false);
  });

  it("never ends a newer call that reused the id after a reset", async () => {
    const first = await dailyCheck();
    const oldGrace = await callFor(first.callIds, IDS.p5);
    expect((await resetDemo()).status).toBe(200);
    await vi.advanceTimersByTimeAsync(RING_MS / 2);
    const second = await dailyCheck();
    const newGrace = await callFor(second.callIds, IDS.p5);
    expect(newGrace.id).toBe(oldGrace.id); // ids restart after a reset
    await vi.advanceTimersByTimeAsync(RING_MS / 2 + 1_000); // the old timer fires
    expect((await getStore().getCall(newGrace.id))?.state).not.toBe("ended");
    await vi.advanceTimersByTimeAsync(RING_MS); // its own timer does
    expect((await getStore().getCall(newGrace.id))?.state).toBe("ended");
  });
});

describe("a refill already on its way (AUDIT 14)", () => {
  async function approveSamsRefill() {
    await getStore().saveOrder({ id: "o_test_sam", rxId: IDS.samConcerta, patientId: IDS.sam, state: "approved", createdAt: SEED.now });
  }

  it("isn't rung about by the daily check", async () => {
    await approveSamsRefill();
    const { callIds, skipped } = await dailyCheck();
    for (const id of callIds) expect((await getStore().getCall(id))?.targetPatientId).not.toBe(IDS.sam);
    expect(skipped.some((s) => s.patientId === IDS.sam)).toBe(true);
  });

  it("isn't reminded about on Upcoming: the row says the refill's state, not today", async () => {
    await approveSamsRefill();
    const row = (await upcoming(getStore())).rows.find((r) => r.rxId === IDS.samConcerta)!;
    expect(row.nextReminder).not.toBe("today");
    expect(row.nextReminder).toMatch(/approved/);
  });

  it("still reminds about a prescription whose last order was declined", async () => {
    await getStore().saveOrder({ id: "o_test_sam", rxId: IDS.samConcerta, patientId: IDS.sam, state: "denied", createdAt: SEED.now });
    const row = (await upcoming(getStore())).rows.find((r) => r.rxId === IDS.samConcerta)!;
    expect(row.nextReminder).toBe("today");
  });
});
