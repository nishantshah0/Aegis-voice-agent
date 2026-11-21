// No key and no network: the only test that reaches the ElevenLabs path stubs
// `fetch`, and Chrome's voice is a no-op outside a browser.

import { describe, expect, it, vi } from "vitest";

import { createVoiceOut } from "./voice-out";

describe("choosing the voice", () => {
  it("speaks with Chrome when no clip endpoint is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const voice = createVoiceOut({ pharmacyName: "Maple Street Pharmacy" });
    await voice.say("One moment.");

    // Nothing was asked of the server, because there is no endpoint to ask.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks the clip endpoint once one is configured", async () => {
    const bytes = new TextEncoder().encode("audio").buffer as ArrayBuffer;
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const voice = createVoiceOut({ clipEndpoint: "/api/voice/clip" });
    await voice.say("One moment.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/voice/clip");
    vi.unstubAllGlobals();
  });

  it("keeps speaking through Chrome when the endpoint is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    const problems: string[] = [];

    const voice = createVoiceOut({
      clipEndpoint: "/api/voice/clip",
      onProblem: (line) => problems.push(line),
    });
    await expect(voice.say("A pharmacist may call you to check in.")).resolves.toBeUndefined();

    // Reported, and the line still went somewhere rather than vanishing.
    expect(problems).toEqual(["A pharmacist may call you to check in."]);
    vi.unstubAllGlobals();
  });

  it("brackets speech once, not once per voice", async () => {
    const bytes = new TextEncoder().encode("audio").buffer as ArrayBuffer;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const states: boolean[] = [];

    const voice = createVoiceOut({ clipEndpoint: "/api/voice/clip", onSpeaking: (s) => states.push(s) });
    await Promise.all([voice.say("First."), voice.say("Second.")]);

    // The fallback must not report speaking of its own, or the phone would
    // reopen the microphone mid-queue.
    expect(states).toEqual([true, false]);
    vi.unstubAllGlobals();
  });
});
