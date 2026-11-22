import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./calls/[id]/recording/route";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { linkConversation, registerVoiceCall, resetVoiceLineForTests } from "./_lib/voice-line";

const staff = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/auth/session", () => ({ getApprover: async () => staff.signedIn ? { role: "reviewer" } : null }));
vi.mock("next/server", async (load) => ({ ...(await load<typeof import("next/server")>()), connection: async () => {} }));

const request = () => GET(new Request("http://test/api/calls/c_1/recording?conversation=wrong"), { params: Promise.resolve({ id: "c_1" }) });
const fetchAudio = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }));

describe("original call recording", () => {
  beforeEach(async () => {
    staff.signedIn = true;
    vi.stubGlobal("fetch", fetchAudio);
    vi.stubEnv("ELEVENLABS_API_KEY", "test");
    resetVoiceLineForTests();
    await resetRuntimeForTests();
    await getStore().saveCall({ id: "c_1", direction: "outbound", state: "ended", startedAt: "2026-11-22T09:00:00Z", failedCodeTries: 0, callerSaid: [] });
  });
  afterEach(() => { fetchAudio.mockClear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("streams the recording linked by the phone line across voice runtime restarts", async () => {
    await linkConversation(registerVoiceCall("c_1", "outbound"), "conv_demo");
    resetVoiceLineForTests();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(fetchAudio).toHaveBeenCalledWith("https://api.elevenlabs.io/v1/convai/conversations/conv_demo/audio", expect.anything());
  });
  it("requires staff and a call-linked provider id even with demo controls on", async () => {
    vi.stubEnv("DEMO_CONTROLS", "on");
    staff.signedIn = false;
    expect((await request()).status).toBe(401);
    staff.signedIn = true;
    expect((await request()).status).toBe(404);
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});
