import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { replayTickets } from "../../_lib/replay-tickets";
import { POST } from "./route";

const render = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
const scope = "public-simulation/greeting_slang_recovery";
const request = (body: object, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost:3002/api/simulation/speak", { method: "POST", body: JSON.stringify(body), headers }));
function ticket(source: string) {
  return replayTickets(source, [{ seq: 2, kind: "caller_line", text: "Hey" }])![2];
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PATIENT_SIMULATION", "community-demo");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubGlobal("fetch", render);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); render.mockClear(); });

it("voices the signed synthetic utterance", async () => {
  const result = await request({ ticket: ticket(scope) }, { origin: "http://localhost:3002" });
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toBe("audio/mpeg");
  expect(render).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.stringContaining('"text":"Hey"') }));
});

it("rejects unrecorded lines, staff replay tickets, nonlocal callers and persistent data mode before synthesis", async () => {
  expect((await request({ text: "custom" })).status).toBe(403);
  expect((await request({ ticket: ticket("staff/record") })).status).toBe(403);
  const body = { ticket: ticket(scope) };
  for (const [key, value] of [["origin", "https://example.org"], ["host", "example.org"], ["x-forwarded-host", "example.org"], ["sec-fetch-site", "cross-site"]]) {
    expect((await request(body, { [key]: value })).status).toBe(403);
  }
  vi.stubEnv("DATABASE_URL", "configured");
  expect((await request(body)).status).toBe(403);
  expect(render).not.toHaveBeenCalled();
});
