import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import type { Delivered } from "@/lib/events/types";
import type { CallSayResponse, CallStartResponse, ClockResponse } from "@/lib/contract";
import { resetRuntimeForTests } from "./_lib/runtime";
import { GET as getClock, POST as setClock } from "./clock/route";
import { POST as startCall } from "./call/start/route";
import { POST as say } from "./call/[id]/say/route";
import { POST as decide } from "./queue/[id]/decide/route";
import { POST as reset } from "./demo/reset/route";

// connection() only works inside a real Next request; outside one it throws.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

afterEach(() => {
  resetBusForTests();
  resetRuntimeForTests();
});

const post = (body: unknown) =>
  new Request("http://test.local/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/clock", () => {
  it("sets the store's clock, keeps the offset, and emits a clock event", async () => {
    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    const res = await setClock(post({ now: "2026-01-06T10:00:00-05:00" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as ClockResponse).toEqual({ now: "2026-01-06T10:00:00-05:00" });
    expect(got.map((d) => d.event)).toEqual([{ type: "clock", now: "2026-01-06T10:00:00-05:00" }]);
    expect(await (await getClock()).json()).toEqual({ now: "2026-01-06T10:00:00-05:00" });
  });

  it("rejects a missing or bad time", async () => {
    expect((await setClock(post({ now: "not a date" }))).status).toBe(400);
    expect((await setClock(post({}))).status).toBe(400);
    expect((await setClock(post("not json"))).status).toBe(400);
  });
});

describe("calls", () => {
  it("starts a call, then the driver emits the caller's line", async () => {
    const started = await startCall(post({ direction: "inbound" }));
    expect(started.status).toBe(201);
    const { callId } = (await started.json()) as CallStartResponse;
    expect(typeof callId).toBe("string");

    const got: Delivered[] = [];
    subscribe((d) => got.push(d));
    const res = await say(post({ text: "  I need a refill  " }), params(callId));
    expect(res.status).toBe(200);
    expect(got.map((d) => d.event)).toContainEqual({ type: "line", callId, who: "caller", text: "I need a refill" });
    const body = (await res.json()) as CallSayResponse;
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("rejects a bad direction, an unknown call and an empty line", async () => {
    expect((await startCall(post({ direction: "sideways" }))).status).toBe(400);
    expect((await say(post({ text: "hi" }), params("call_missing"))).status).toBe(404);
    const { callId } = (await (await startCall(post({ direction: "outbound" }))).json()) as CallStartResponse;
    expect((await say(post({ text: "   " }), params(callId))).status).toBe(400);
  });
});

describe("POST /api/queue/:id/decide", () => {
  it("refuses without a signed-in pharmacist, even if the body names one", async () => {
    const res = await decide(post({ decision: "approve", approver: { id: "x", role: "pharmacist" } }), params("q_1"));
    expect(res.status).toBe(401);
  });
});

describe("endpoints for later tasks", () => {
  it("say which task builds them", async () => {
    const res = await reset();
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/task 2\.2/);
  });
});
