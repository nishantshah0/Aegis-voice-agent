import { describe, expect, it } from "vitest";
import { createServerVoice, type AudioPlayer } from "./server-voice";
import type { Voice } from "./speaker";

/** Fake audio: each clip "plays" until the test ends it. */
function fakeAudio() {
  const played: string[] = [];
  let finish: (() => void) | undefined;
  const play: AudioPlayer = (clip) => {
    played.push(clip.label);
    return {
      done: new Promise<void>((r) => (finish = r)),
      stop: () => finish?.(),
    };
  };
  return { play, played, endCurrent: () => finish?.() };
}

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 200 ? new Blob(["mp3"]) : JSON.stringify({ error: "x" }), { status });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function fallbackVoice() {
  const said: string[] = [];
  const v: Voice = { say: async (l) => void said.push(l), stop: () => {} };
  return { v, said };
}

describe("1.5 part 2: ElevenLabs voice through the server", () => {
  it("asks the call's speak route with its phone token, for the line as it should sound", async () => {
    const f = fakeFetch();
    const audio = fakeAudio();
    const voice = createServerVoice({ callId: "c_1", token: "tok", fetch: f.fn, play: audio.play, toUrl: (b) => `blob:${b.size}`, fallback: fallbackVoice().v });
    const done = voice.say("It's $4.10 on your plan.");
    await tick();
    expect(f.calls[0].url).toBe("/api/call/c_1/speak");
    expect((f.calls[0].init.headers as Record<string, string>)["x-phone-token"]).toBe("tok");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ text: "It's four dollars and ten cents on your plan." });
    audio.endCurrent();
    await done;
  });

  it("plays lines in order, one at a time, and says when it's speaking", async () => {
    const f = fakeFetch();
    const audio = fakeAudio();
    const speaking: boolean[] = [];
    const voice = createServerVoice({ callId: "c_1", token: "t", fetch: f.fn, play: audio.play, toUrl: () => "blob:x", fallback: fallbackVoice().v, onSpeaking: (s) => speaking.push(s) });
    const a = voice.say("First.");
    const b = voice.say("Second.");
    await tick();
    expect(audio.played).toEqual(["First."]);
    audio.endCurrent();
    await a;
    await tick();
    expect(audio.played).toEqual(["First.", "Second."]);
    audio.endCurrent();
    await b;
    expect(speaking).toEqual([true, false]);
  });

  it("fetches a repeated line once (fixed lines play at once the second time)", async () => {
    const f = fakeFetch();
    const audio = fakeAudio();
    const voice = createServerVoice({ callId: "c_1", token: "t", fetch: f.fn, play: audio.play, toUrl: () => "blob:x", fallback: fallbackVoice().v });
    for (let i = 0; i < 2; i++) {
      const p = voice.say("One moment.");
      await tick();
      audio.endCurrent();
      await p;
    }
    expect(f.calls).toHaveLength(1);
    expect(audio.played).toEqual(["One moment.", "One moment."]);
  });

  it("falls back to the browser's voice when the route can't speak (no key, limit, missing)", async () => {
    for (const status of [503, 429, 404]) {
      const fb = fallbackVoice();
      const voice = createServerVoice({ callId: "c_1", token: "t", fetch: fakeFetch(status).fn, play: fakeAudio().play, toUrl: () => "blob:x", fallback: fb.v });
      await voice.say("Hello.");
      expect(fb.said).toEqual(["Hello."]);
    }
  });

  it("stops at once and drops the queue (tap to interrupt)", async () => {
    const audio = fakeAudio();
    const speaking: boolean[] = [];
    const voice = createServerVoice({ callId: "c_1", token: "t", fetch: fakeFetch().fn, play: audio.play, toUrl: () => "blob:x", fallback: fallbackVoice().v, onSpeaking: (s) => speaking.push(s) });
    const a = voice.say("A long line.");
    const b = voice.say("Never said.");
    await tick();
    voice.stop();
    await Promise.all([a, b]);
    expect(audio.played).toEqual(["A long line."]);
    expect(speaking.at(-1)).toBe(false);
  });
});
