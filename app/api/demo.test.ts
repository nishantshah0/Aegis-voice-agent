import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver, DecideResponse, ResetResponse, RunDailyCheckResponse, StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { DEMO_NOW, IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as resetDemo } from "./demo/reset/route";
import { POST as runDailyCheck } from "./outbound/run-daily-check/route";
import { POST as setClock } from "./clock/route";
import { POST as decide } from "./queue/[id]/decide/route";

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
const post = (body?: unknown) =>
  new Request("http://test.local/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

let events: StreamEvent[] = [];
beforeEach(async () => {
  session.approver = null;
  await resetRuntimeForTests();
  events = [];
  subscribe((d) => events.push(d.event));
});
afterEach(() => {
  resetBusForTests();
  vi.unstubAllEnvs();
});

describe("demo controls", () => {
  it("refuse someone who isn't signed in", async () => {
    expect((await resetDemo()).status).toBe(401);
    expect((await runDailyCheck()).status).toBe(401);
  });

  it("are open to anyone when the server's DEMO_CONTROLS switch is on", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    expect((await resetDemo()).status).toBe(200);
    expect((await setClock(post({ now: DEMO_NOW }))).status).toBe(200);
  });
});

describe("POST /api/demo/reset", () => {
  it("reseeds, sets Tuesday 10 AM and tells every page", async () => {
    session.approver = PHARMACIST;
    await getStore().setNow("2026-12-01T09:00:00-05:00");
    await getStore().addQueueItem({ callId: "c_x", patientId: IDS.sam, kind: "refill", lane: "review", ruleIds: [], signals: [], notes: [] });
    const res = await resetDemo();
    expect(res.status).toBe(200);
    expect((await res.json()) as ResetResponse).toEqual({ now: DEMO_NOW });
    expect(await getStore().now()).toBe(DEMO_NOW);
    expect(await getStore().queue()).toEqual([]);
    expect(events).toContainEqual({ type: "clock", now: DEMO_NOW });
  });
});

describe("POST /api/outbound/run-daily-check", () => {
  it("rings Sam about his Concerta at Tuesday 10 AM, through rule 7, and says who it skipped", async () => {
    session.approver = PHARMACIST;
    await resetDemo();
    const res = await runDailyCheck();
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDailyCheckResponse;
    const calls = await Promise.all(body.callIds.map((id) => getStore().getCall(id)));
    expect(calls.map((c) => c?.targetPatientId)).toContain(IDS.sam);
    for (const id of body.callIds) expect(events).toContainEqual(expect.objectContaining({ type: "phone", callId: id, kind: "ring" }));
    for (const s of body.skipped) expect(s.ruleIds.length).toBeGreaterThan(0);
  });

  it("doesn't ring anyone twice while their call is still open", async () => {
    session.approver = PHARMACIST;
    await resetDemo();
    const first = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    const second = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    expect(first.callIds.length).toBeGreaterThan(0);
    expect(second.callIds).toEqual([]);
  });
});

describe("Sam's refill, approved on the console", () => {
  it("goes from the daily check through the real lock to a pharmacist's approval in the record", async () => {
    session.approver = PHARMACIST;
    await resetDemo();
    const { callIds } = (await (await runDailyCheck()).json()) as RunDailyCheckResponse;
    const calls = await Promise.all(callIds.map((id) => getStore().getCall(id)));
    const callId = calls.find((c) => c?.targetPatientId === IDS.sam)!.id;
    const control = getControl();

    // What a driver would press for Sam (Role 1's agent does this in the real call).
    const lookupId = `out_${callId}`;
    await control.press(callId, "send_code", { lookup_id: lookupId });
    const code = events
      .filter((e): e is Extract<StreamEvent, { type: "phone" }> => e.type === "phone" && e.callId === callId && e.kind === "code")
      .map((e) => e.text.match(/\d{6}/)?.[0])
      .pop()!;
    expect(await control.press(callId, "check_code", { lookup_id: lookupId, code })).toMatchObject({ ok: true });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samConcerta })).toMatchObject({ ok: true, lane: "quick_check" });

    const [item] = await getStore().queue("quick_check");
    const res = await decide(post({ decision: "approve", approver: { id: "mallory", name: "Mallory", role: "pharmacist" } }), {
      params: Promise.resolve({ id: item.id }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DecideResponse).item).toMatchObject({ status: "approved", decidedBy: PHARMACIST });
    const approval = (await getStore().listRecord(callId)).find((e) => e.kind === "approval");
    expect(approval).toMatchObject({ actor: "pharmacist", input: { approver: PHARMACIST } });
    expect(JSON.stringify(approval)).not.toContain("mallory");
  });
});
