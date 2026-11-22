import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { ownsSession } from "../handlers";
import { latestTurn } from "../storage";

vi.mock("../handlers", () => ({ ownsSession: vi.fn() }));
vi.mock("../storage", () => ({ latestTurn: vi.fn() }));

const origin = "https://example.test";
const proof = "x".repeat(32);
function recording(withProof = true) {
  const form = new FormData();
  form.append("sessionId", "session");
  form.append("file", new Blob(["fixture"], { type: "audio/webm" }), "recording.webm");
  const headers = new Headers({ origin });
  if (withProof) headers.set("x-aegis-presenter", proof);
  return new Request(origin + "/api/presenter/browser/transcribe", { method: "POST", headers, body: form });
}

describe("browser microphone transcription", () => {
  beforeEach(() => {
    vi.stubEnv("AEGIS_PUBLIC_ORIGIN", origin);
    vi.stubEnv("AEGIS_PRESENTER_SECRET", proof);
    vi.stubEnv("ELEVENLABS_API_KEY", "fixture");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PATIENT_SIMULATION", "community-demo");
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(ownsSession).mockReturnValue(true);
    vi.mocked(latestTurn).mockResolvedValue({ flow: { phase: "menu" } } as Awaited<ReturnType<typeof latestTurn>>);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("requires presenter access and a live conversation owned by this browser", async () => {
    expect((await POST(recording(false))).status).toBe(403);
    vi.mocked(ownsSession).mockReturnValue(false);
    expect((await POST(recording())).status).toBe(403);
    vi.mocked(ownsSession).mockReturnValue(true);
    vi.mocked(latestTurn).mockResolvedValue(undefined);
    expect((await POST(recording())).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the recording transcript and reports unintelligible audio", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ text: "My last refill?" }))
      .mockResolvedValueOnce(Response.json({ text: " " }));
    const transcript = await POST(recording());
    expect(await transcript.json()).toEqual({ text: "My last refill?" });
    expect((await POST(recording())).status).toBe(422);
  });
});
