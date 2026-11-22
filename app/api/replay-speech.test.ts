import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayTickets } from "./_lib/replay-tickets";
import { resetSpeechBudgetForTests, takeSpeechChars } from "./_lib/phone";
import { POST } from "./calls/replay/speak/route";

const session = vi.hoisted(() => ({ staff: true }));
vi.mock("@/lib/auth/session", () => ({ getApprover: async () => session.staff ? { role: "reviewer" } : null }));
const source = [
  { seq: 1, kind: "caller_line", text: "Hello" },
  { seq: 2, kind: "line_blocked", text: "Unspoken original", replacement: "Please wait" },
  { seq: 3, kind: "button", text: "Private details" },
];
const endpoint = (body: object) => POST(new Request("http://test/api/calls/replay/speak", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
}));
const audio = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array([1, 2, 3])));

describe("saved call ElevenLabs playback", () => {
  beforeEach(() => {
    session.staff = true;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "pharmacy");
    vi.stubEnv("ELEVENLABS_ATTACKER_VOICE_ID", "caller");
    vi.stubGlobal("fetch", audio);
    resetSpeechBudgetForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); audio.mockClear(); });
  it("speaks only the archived caller speech and the guard replacement using distinct voices", async () => {
    const tickets = replayTickets("demo/call-1", source)!;
    expect(Object.keys(tickets)).toEqual(["1", "2"]);
    expect((await endpoint({ ticket: tickets[1] })).status).toBe(200);
    expect((await endpoint({ ticket: tickets[2], text: "Unspoken original", voice: "caller" })).status).toBe(200);
    expect(audio.mock.calls.map(([url, init]) => [new URL(url).pathname, JSON.parse(String(init.body)).text])).toEqual([
      ["/v1/text-to-speech/caller/stream", "Hello"], ["/v1/text-to-speech/pharmacy/stream", "Please wait"],
    ]);
  });
  it("rejects unrecorded text, changed tickets, expired tickets, and signed-out requests before synthesis", async () => {
    const ticket = replayTickets("demo/call-2", source)![2];
    const forged = ticket.split(".");
    const data = JSON.parse(Buffer.from(forged[0], "base64url").toString());
    forged[0] = Buffer.from(JSON.stringify({ ...data, text: "unrecorded" })).toString("base64url");
    expect((await endpoint({ text: "unrecorded" })).status).toBe(403);
    expect((await endpoint({ ticket: forged.join(".") })).status).toBe(403);
    session.staff = false;
    expect((await endpoint({ ticket })).status).toBe(401);
    session.staff = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(data.expires + 1));
    expect((await endpoint({ ticket })).status).toBe(403);
    expect(audio).not.toHaveBeenCalled();
  });
  it("refuses a saved caller line when other calls have exhausted the shared hourly voice budget", async () => {
    expect(takeSpeechChars(20_000, 20_000)).toBe(true);
    const ticket = replayTickets("demo/budget", source)![1];
    expect((await endpoint({ ticket })).status).toBe(429);
    expect(audio).not.toHaveBeenCalled();
  });
  it("allows a labeled browser fallback if the provider has no key or refuses synthesis", async () => {
    audio.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await endpoint({ ticket: replayTickets("demo/call-3", source)![1] })).status).toBe(502);
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(replayTickets("demo/call-3", source)).toBeUndefined();
    expect((await endpoint({})).status).toBe(503);
  });
});
