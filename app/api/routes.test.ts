import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import type { Delivered } from "@/lib/events/types";
import type { CallSayResponse, CallStartResponse, ClockResponse, DecideResponse } from "@/lib/contract";
import type { Approver } from "@/lib/contract";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { GET as getClock, POST as setClock } from "./clock/route";
import { POST as startCall } from "./call/start/route";
import { POST as say } from "./call/[id]/say/route";
import { POST as decide } from "./queue/[id]/decide/route";
import { GET as gateLatest } from "./gate/latest/route";

// connection() only works inside a real Next request; outside one it throws.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

// The signed-in person comes from the Auth0 session; tests set it here.
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const REVIEWER: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };

beforeEach(async () => {
  session.approver = null;
  await resetRuntimeForTests();
});

afterEach(() => {
  resetBusForTests();
});

const post = (body: unknown) =>
  new Request("http://test.local/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const withToken = (body: unknown, token: string) =>
  new Request("http://test.local/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-phone-token": token },
    body: JSON.stringify(body),
  });

describe("/api/clock", () => {
  it("sets the store's clock, keeps the offset, and emits a clock event", async () => {
    session.approver = REVIEWER;
    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    const res = await setClock(post({ now: "2026-01-06T10:00:00-05:00" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as ClockResponse).toEqual({ now: "2026-01-06T10:00:00-05:00" });
    expect(got.map((d) => d.event)).toEqual([{ type: "clock", now: "2026-01-06T10:00:00-05:00" }]);
    expect(await (await getClock()).json()).toEqual({ now: "2026-01-06T10:00:00-05:00" });
  });

  it("refuses to move the clock for someone not signed in (unless demo controls are on)", async () => {
    expect((await setClock(post({ now: "2026-01-06T10:00:00-05:00" }))).status).toBe(401);
  });

  it("rejects a missing or bad time", async () => {
    session.approver = REVIEWER;
    expect((await setClock(post({ now: "not a date" }))).status).toBe(400);
    expect((await setClock(post({}))).status).toBe(400);
    expect((await setClock(post("not json"))).status).toBe(400);
  });
});

describe("calls", () => {
  it("starts a call, then the driver emits the caller's line", async () => {
    const started = await startCall(post({ direction: "inbound" }));
    expect(started.status).toBe(201);
    const { callId, phoneToken } = (await started.json()) as CallStartResponse & { phoneToken: string };
    expect(typeof callId).toBe("string");
    expect(phoneToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    const res = await say(withToken({ text: "  I need a refill  " }, phoneToken), params(callId));
    expect(res.status).toBe(200);
    expect(got.map((d) => d.event)).toContainEqual({ type: "line", callId, who: "caller", text: "I need a refill" });
    const body = (await res.json()) as CallSayResponse;
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("rejects a bad direction, an outbound start, an unknown call and an empty line", async () => {
    expect((await startCall(post({ direction: "sideways" }))).status).toBe(400);
    // Outbound calls only start from the daily check, through rule 7.
    expect((await startCall(post({ direction: "outbound", patientId: "p_sam" }))).status).toBe(400);
    expect((await say(post({ text: "hi" }), params("call_missing"))).status).toBe(404);
    const { callId, phoneToken } = (await (await startCall(post({ direction: "inbound" }))).json()) as CallStartResponse & { phoneToken: string };
    expect((await say(withToken({ text: "   " }, phoneToken), params(callId))).status).toBe(400);
  });
});

describe("POST /api/queue/:id/decide", () => {
  const openItem = () =>
    getStore().addQueueItem({ callId: "c_test", patientId: "p_test", kind: "refill", lane: "review", ruleIds: ["4"], signals: [], notes: [] });

  it("refuses without a signed-in pharmacist, even if the body names one", async () => {
    const res = await decide(post({ decision: "approve", approver: { id: "x", role: "pharmacist" } }), params("q_1"));
    expect(res.status).toBe(401);
  });

  it("refuses a signed-in reviewer", async () => {
    session.approver = REVIEWER;
    const item = await openItem();
    expect((await decide(post({ decision: "approve" }), params(item.id))).status).toBe(403);
    expect((await getStore().queue()).find((q) => q.id === item.id)?.status).toBe("open");
  });

  it("approves as the signed-in pharmacist, ignoring any approver in the body, and emits the item", async () => {
    session.approver = PHARMACIST;
    const item = await openItem();
    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    const res = await decide(
      post({ decision: "approve", note: "Chat at pickup", approver: { id: "someone-else", name: "Mallory", role: "pharmacist" } }),
      params(item.id),
    );
    expect(res.status).toBe(200);
    const { item: decided } = (await res.json()) as DecideResponse;
    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).toEqual(PHARMACIST);
    expect(decided.decisionNote).toBe("Chat at pickup");
    expect(got.map((d) => d.event)).toContainEqual({ type: "queue", item: decided });
  });

  it("tells the patient's phone when a refill with an order is approved or denied", async () => {
    session.approver = PHARMACIST;
    const store = getStore();
    const order = await store.saveOrder({ id: "o_test", rxId: "rx_test", patientId: "p_test", state: "waiting_for_pharmacist", createdAt: await store.now() });
    const item = await store.addQueueItem({ callId: "c_test", patientId: "p_test", orderId: order.id, kind: "refill", lane: "quick_check", ruleIds: ["4"], signals: [], notes: [] });
    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    await decide(post({ decision: "approve" }), params(item.id));
    expect(got.map((d) => d.event)).toContainEqual(expect.objectContaining({ type: "phone", callId: "c_test", kind: "status" }));
  });

  it("denies, then refuses to decide the same item twice", async () => {
    session.approver = PHARMACIST;
    const item = await openItem();
    const res = await decide(post({ decision: "deny" }), params(item.id));
    expect(((await res.json()) as DecideResponse).item.status).toBe("denied");
    expect((await decide(post({ decision: "approve" }), params(item.id))).status).toBe(409);
  });

  it("rejects an unknown item and a bad decision", async () => {
    session.approver = PHARMACIST;
    expect((await decide(post({ decision: "approve" }), params("q_missing"))).status).toBe(404);
    const item = await openItem();
    expect((await decide(post({ decision: "maybe" }), params(item.id))).status).toBe(400);
  });
});

describe("endpoints for later tasks", () => {
  it("say which task builds them", async () => {
    const res = await gateLatest();
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/Role 4/);
  });
});
