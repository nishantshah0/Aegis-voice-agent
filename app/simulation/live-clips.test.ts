import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallPlayback } from "./call-playback";
import { BLOCKED_TONE, blockedToneWav, clipsFromEvents } from "./live-clips";
import type { TestEvent } from "./live-events";

// Business tests: hear each test call as it happens. Only lines the guard let through are
// voiced (by ticket); a replaced line plays a short tone first, never the blocked text.

describe("the blocked-line tone", () => {
  it("is a short mono 8 kHz WAV, made in the browser with no file or provider", () => {
    const wav = blockedToneWav();
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    const seconds = view.getUint32(40, true) / 2 / 8000;
    expect(seconds).toBeGreaterThan(0.3);
    expect(seconds).toBeLessThan(0.8);
    expect(BLOCKED_TONE).toMatch(/^data:audio\/wav;base64,/);
  });
});

describe("clips from a test call's events", () => {
  it("voices ticketed lines in order, skips redacted ones, and puts the tone before a replaced line", () => {
    const events: TestEvent[] = [
      { type: "start", scenarioId: "act_like_a_pirate" },
      { type: "line", speaker: "caller", text: "Ahoy, matey!", ticket: "t1" },
      { type: "line", speaker: "caller", text: "[Verification details omitted]" },
      { type: "action", label: "Speech guard replaced a line" },
      { type: "line", speaker: "pharmacy", text: "A pharmacist will check it first.", ticket: "t2" },
      { type: "action", label: "Refused: request refill" },
      { type: "check", label: "no refill", passed: true },
      { type: "verdict", passed: true, caught: 1, broken: 0 },
    ];
    expect(clipsFromEvents(events)).toEqual([{ ticket: "t1" }, { skip: true }, { url: BLOCKED_TONE }, { ticket: "t2" }]);
  });
});

class FakeAudio {
  static instance: FakeAudio;
  src = "";
  muted = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(async () => { this.onplaying?.(); });
  constructor() { FakeAudio.instance = this; }
}

describe("muting the call", () => {
  beforeEach(() => { vi.stubGlobal("Audio", FakeAudio); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps the queue moving silently, and unmutes the same element", () => {
    const player = new CallPlayback([{ url: "/one" }, { url: "/two" }], true);
    player.mute(true);
    player.play();
    const a = FakeAudio.instance;
    expect(a.muted).toBe(true);
    a.onended?.();
    expect(a.src).toBe("/two");
    player.mute(false);
    expect(a.muted).toBe(false);
    expect(player.snapshot().muted).toBe(false);
  });
});
