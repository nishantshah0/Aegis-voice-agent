import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneApi } from "./api";

afterEach(() => vi.unstubAllGlobals());

function capture(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

describe("1.4: the phone sends its call's token", () => {
  it("sends x-phone-token on say, code and end", async () => {
    const calls = capture();
    await phoneApi.say("c_1", "hi", "tok");
    await phoneApi.code("c_1", "tok");
    await phoneApi.end("c_1", "tok");
    for (const c of calls) expect((c.init.headers as Record<string, string>)["x-phone-token"]).toBe("tok");
    expect(calls.map((c) => c.url)).toEqual(["/api/call/c_1/say", "/api/call/c_1/code", "/api/call/c_1/end"]);
  });

  it("returns the token from answer, and says plainly when a route isn't there", async () => {
    capture(200, { callId: "c_1", phoneToken: "tok", events: [] });
    expect(await phoneApi.answer("c_1")).toEqual({ ok: true, value: { callId: "c_1", phoneToken: "tok", events: [] } });
    capture(404, { error: "No such call" });
    expect(await phoneApi.answer("c_1")).toEqual({ ok: false, problem: "Answer isn't connected yet." });
    capture(401, { error: "This phone can't speak on that call" });
    expect(await phoneApi.say("c_1", "hi")).toEqual({ ok: false, problem: "This phone can't speak on that call" });
  });
});

describe("Trail #70: a code sent to this paired phone during a real phone call", () => {
  it("asks /api/phone/code with no token (the pairing cookie goes by itself)", async () => {
    const calls = capture(200, { code: "112358" });
    expect(await phoneApi.deviceCode()).toEqual({ ok: true, value: { code: "112358" } });
    expect(calls[0].url).toBe("/api/phone/code");
    expect((calls[0].init.headers as Record<string, string> | undefined)?.["x-phone-token"]).toBeUndefined();
  });

  it("reads 204 as no code, and a refusal as a problem (so an unpaired phone stops asking)", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    expect(await phoneApi.deviceCode()).toEqual({ ok: true, value: {} });
    capture(401, { error: "Only a paired phone can read its codes" });
    expect(await phoneApi.deviceCode()).toEqual({ ok: false, problem: "Only a paired phone can read its codes" });
  });
});
