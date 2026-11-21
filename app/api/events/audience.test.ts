import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { emit, resetBusForTests } from "@/lib/events/bus";
import { clearPhoneTokens, issuePhoneToken } from "../_lib/phone";
import { GET as stream } from "./route";
import { GET as poll } from "./poll/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

beforeEach(() => {
  session.approver = null;
  resetBusForTests();
  clearPhoneTokens();
});

function seedEvents() {
  emit({ type: "line", callId: "c_1", who: "caller", text: "I'm Sam Rivera" }); // 1
  emit({ type: "blocked_line", callId: "c_1", rule: "S1", original: "Your Concerta is due Friday, Sam Rivera.", replacement: "I can help with that once you're verified." }); // 2
  emit({ type: "line", callId: "c_2", who: "caller", text: "I'm Grace Okafor" }); // 3
  emit({ type: "score", caught: 1, broken: 0 }); // 4
}

/** Everything a client would receive from a replay (Last-Event-ID: 0) within a moment. */
async function replay(query = ""): Promise<{ status: number; text: string }> {
  const abort = new AbortController();
  const res = await stream(new Request(`http://test.local/api/events${query}`, { headers: { "last-event-id": "0" }, signal: abort.signal }));
  if (!res.body) return { status: res.status, text: await res.text() };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const until = Date.now() + 100;
  while (Date.now() < until) {
    const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), until - Date.now()))]);
    if (next === null || next.done) break;
    text += decoder.decode(next.value);
  }
  abort.abort();
  return { status: res.status, text };
}

describe("GET /api/events by audience (Trail #3, second review)", () => {
  it("an anonymous client gets no caller lines and no blocked originals, even on replay", async () => {
    seedEvents();
    const { status, text } = await replay();
    expect(status).toBe(200);
    expect(text).toContain('"caught":1');
    expect(text).not.toMatch(/Sam Rivera|Grace Okafor|Concerta/);
  });

  it("signed-in staff get the full stream", async () => {
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    seedEvents();
    const { text } = await replay();
    expect(text).toContain("I'm Sam Rivera");
    expect(text).toContain("Your Concerta is due Friday, Sam Rivera.");
  });

  it("a call's phone gets only its own call, and a wrong token gets 403", async () => {
    const token = issuePhoneToken("c_1")!;
    seedEvents();
    const { text } = await replay(`?call=c_1&token=${token}`);
    expect(text).toContain("I'm Sam Rivera");
    expect(text).not.toContain("Grace Okafor");
    expect(text).not.toContain("Your Concerta is due Friday");
    expect((await replay(`?call=c_1&token=wrong`)).status).toBe(403);
  });
});

describe("GET /api/events/poll by audience", () => {
  it("applies the same rules", async () => {
    seedEvents();
    const anon = await (await poll(new Request("http://test.local/api/events/poll?after=0"))).text();
    expect(anon).not.toMatch(/Sam Rivera|Grace Okafor/);
    const token = issuePhoneToken("c_1")!;
    const phone = await (await poll(new Request(`http://test.local/api/events/poll?after=0&call=c_1&token=${token}`))).text();
    expect(phone).toContain("I'm Sam Rivera");
    expect(phone).not.toContain("Grace Okafor");
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    const staff = await (await poll(new Request("http://test.local/api/events/poll?after=0"))).text();
    expect(staff).toContain("Grace Okafor");
  });
});
