import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBusForTests } from "@/lib/events/bus";
import { resetRuntimeForTests } from "./_lib/runtime";
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
  vi.stubEnv("ELEVENLABS_API_KEY", "test-eleven-key");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "voice_test");
  fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function call() {
  const res = await startCall(new Request("http://test.local/api", { method: "POST", body: JSON.stringify({ direction: "inbound" }) }));
  return (await res.json()) as { callId: string; phoneToken: string };
}

describe("POST /api/call/:id/speak (1.5 support)", () => {
  it("streams ElevenLabs Flash audio for the call's own phone, keeping the key on the server", async () => {
    const { callId, phoneToken } = await call();
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

  it("limits text length and requests per call, so a phone can't run up the bill", async () => {
    const { callId, phoneToken } = await call();
    expect((await speak(req({ text: "a".repeat(501) }, phoneToken), params(callId))).status).toBe(413);
    expect((await speak(req({ text: "   " }, phoneToken), params(callId))).status).toBe(400);
    for (let i = 0; i < 60; i++) await speak(req({ text: "Hello" }, phoneToken), params(callId));
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(429);
  });

  it("answers 503 when the voice isn't configured, and 502 when ElevenLabs fails", async () => {
    const { callId, phoneToken } = await call();
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(503);
    vi.stubEnv("ELEVENLABS_VOICE_ID", "voice_test");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect((await speak(req({ text: "Hello" }, phoneToken), params(callId))).status).toBe(502);
  });
});
