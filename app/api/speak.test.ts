import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { createSpeechGuard } from "@/lib/guard";
import { resetSpeechBudgetForTests } from "./_lib/phone";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as startCall } from "./call/start/route";
import { POST as speak } from "./call/[id]/speak/route";

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => null,
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, token?: string) =>
  new Request("http://test.local/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-phone-token": token } : {}) },
    body: JSON.stringify(body),
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
  resetSpeechBudgetForTests();
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "voice_test");
  fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function call(...said: string[]) {
  const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
  const started = (await res.json()) as { callId: string; phoneToken: string };
  // What the speech guard writes for each line it lets the agent say.
  for (const text of said) await getStore().appendRecord({ callId: started.callId, actor: "agent", kind: "line_spoken", input: { text }, decision: "allowed" });
  return started;
}

describe("POST /api/call/:id/speak (1.5 support)", () => {
  it("streams ElevenLabs Flash audio for the call's own phone, keeping the key on the server", async () => {
    const { callId, phoneToken } = await call("One moment.");
    const res = await speak(req({ text: "One moment." }, phoneToken), params(callId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice_test/stream?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-eleven-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "One moment.", model_id: "eleven_flash_v2_5" });
  });

  it("refuses anyone without the call's token, and unknown calls", async () => {
    const { callId } = await call();
    expect((await speak(req({ text: "Hi" }), params(callId))).status).toBe(401);
    expect((await speak(req({ text: "Hi" }, "x"), params("c_9999"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("voices only a line the guard passed on this call, as written or as spoken (Trail #47 finding)", async () => {
    const { callId, phoneToken } = await call("Your code is 112358.");
    const other = await call("Your refill is approved.");
    expect((await speak(req({ text: "Your refill is approved." }, phoneToken), params(callId))).status).toBe(403);
    expect((await speak(req({ text: "Anything at all." }, phoneToken), params(callId))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await speak(req({ text: "Your code is 1 1 2, 3 5 8." }, phoneToken), params(callId))).status).toBe(200);
    expect((await speak(req({ text: "Your code is 112358." }, phoneToken), params(callId))).status).toBe(200);
    expect((await speak(req({ text: "Your refill is approved." }, other.phoneToken), params(other.callId))).status).toBe(200);
  });

  it("voices the guard's replacement for a blocked line, never the blocked original (Role 3, 2.9)", async () => {
    const { callId, phoneToken } = await call();
    const other = await call();
    const guarded = await createSpeechGuard({ store: getStore(), emit })(callId, "Your Concerta refill is approved.");
    expect(guarded.blocked).toBe(true);
    const replacement = guarded.speak;
    // The original never reaches the voice, on this call or any other.
    expect((await speak(req({ text: "Your Concerta refill is approved." }, phoneToken), params(callId))).status).toBe(403);
    // The replacement was only said on this call.
    expect((await speak(req({ text: replacement }, other.phoneToken), params(other.callId))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await speak(req({ text: replacement }, phoneToken), params(callId))).status).toBe(200);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ text: replacement });
  });

  it("caps the voice at 20,000 characters an hour across every call", async () => {
    const line = "a".repeat(400);
    let refused = 0;
    for (let c = 0; c < 2 && !refused; c++) {
      const { callId, phoneToken } = await call(line);
      for (let i = 0; i < 60; i++) if ((await speak(req({ text: line }, phoneToken), params(callId))).status === 429) refused++;
    }
    expect(refused).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it("limits text length and requests per call, so a phone can't run up the bill", async () => {
    const { callId, phoneToken } = await call("Hello");
    expect((await speak(req({ text: "a".repeat(501) }, phoneToken), params(callId))).status).toBe(413);
    expect((await speak(req({ text: "   " }, phoneToken), params(callId))).status).toBe(400);
    for (let i = 0; i < 60; i++) await speak(req({ text: "Hello" }, phoneToken), params(callId));
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(429);
  });

  it("answers 503 when the voice isn't configured, and 502 when ElevenLabs fails", async () => {
    const { callId, phoneToken } = await call("Hello");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(503);
    vi.stubEnv("ELEVENLABS_VOICE_ID", "voice_test");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(502);
  });
});
