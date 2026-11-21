import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createListener } from "./listener";

/** Stands in for Chrome's SpeechRecognition. */
class FakeRecognition {
  static all: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = false;
  aborted = false;
  onresult: ((e: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.aborted = true;
  }
  hear(...parts: string[]) {
    this.onresult?.({ results: parts.map((p) => ({ isFinal: false, 0: { transcript: p } })) });
  }
}
const live = () => FakeRecognition.all.filter((r) => r.started && !r.aborted);

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.all = [];
  vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("1.5: speech in", () => {
  it("listens with interim results and sends the turn after 600 ms of silence", () => {
    const turns: string[] = [];
    const l = createListener({ onTurn: (t) => turns.push(t) });
    l.start("open");
    const rec = live()[0];
    expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: "en-US" });
    rec.hear("yes", " please");
    vi.advanceTimersByTime(599);
    expect(turns).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(turns).toEqual(["yes please"]);
    // A fresh recognition for the next turn, so these words aren't heard twice.
    expect(rec.aborted).toBe(true);
    expect(live()).toHaveLength(1);
  });

  it("turns the microphone off while the agent speaks, and drops what it half heard", () => {
    const turns: string[] = [];
    const l = createListener({ onTurn: (t) => turns.push(t) });
    l.start("open");
    live()[0].hear("the agent's own voice");
    l.pause();
    expect(live()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(turns).toEqual([]);
    l.resume();
    expect(live()).toHaveLength(1);
  });

  it("keeps listening when Chrome stops by itself", () => {
    const l = createListener({ onTurn: () => {} });
    l.start("open");
    const first = live()[0];
    first.started = false; // Chrome ended it.
    first.onend?.();
    expect(FakeRecognition.all).toHaveLength(2);
    expect(live()).toHaveLength(1);
    l.stop();
    expect(live()).toHaveLength(0);
  });

  it("hold-to-talk listens only while held and sends the turn on release", () => {
    const turns: string[] = [];
    const l = createListener({ onTurn: (t) => turns.push(t) });
    l.start("hold");
    expect(live()).toHaveLength(0);
    l.holdDown();
    live()[0].hear("my code is 112358");
    l.holdUp();
    expect(turns).toEqual(["my code is 112358"]);
    expect(live()).toHaveLength(0);
  });

  it("says plainly when the microphone isn't allowed", () => {
    const problems: string[] = [];
    const l = createListener({ onTurn: () => {}, onProblem: (p) => problems.push(p) });
    l.start("open");
    live()[0].onerror?.({ error: "not-allowed" });
    expect(problems[0]).toMatch(/microphone isn't allowed/);
  });

  it("says so when the browser has no speech recognition", () => {
    vi.stubGlobal("window", {});
    const problems: string[] = [];
    createListener({ onTurn: () => {}, onProblem: (p) => problems.push(p) }).start("open");
    expect(problems[0]).toMatch(/no speech recognition/);
  });
});
