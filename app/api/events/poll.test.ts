import { beforeEach, describe, expect, it, vi } from "vitest";
import { emit, resetBusForTests } from "@/lib/events/bus";
import type { Delivered } from "@/lib/events/types";
import { GET as poll } from "./poll/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

beforeEach(() => resetBusForTests());

const get = (query = "") => new Request(`http://test.local/api/events/poll${query}`);
type Poll = { events: Delivered[]; last: number };

describe("GET /api/events/poll", () => {
  it("starts from now when no id is given", async () => {
    emit({ type: "clock", now: "2026-11-24T10:00:00-05:00" });
    expect((await (await poll(get())).json()) as Poll).toEqual({ events: [], last: 1 });
  });

  it("returns the public events after an id, in order, never a code or a caller line", async () => {
    emit({ type: "clock", now: "2026-11-24T10:00:00-05:00" }); // 1
    emit({ type: "phone", callId: "c_1", kind: "ring", text: "Maple Street Pharmacy is calling" }); // 2
    emit({ type: "phone", callId: "c_1", kind: "code", text: "Your pharmacy verification code is 123456." }); // 3
    emit({ type: "line", callId: "c_1", who: "agent", text: "Hello" }); // 4
    const body = (await (await poll(get("?after=1"))).json()) as Poll;
    // Anonymous pollers get the ring but not the call's lines (Trail #3, second review).
    expect(body.events.map((d) => d.id)).toEqual([2]);
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(body.last).toBe(4);
  });

  it("rejects a bad id", async () => {
    expect((await poll(get("?after=abc"))).status).toBe(400);
  });
});
