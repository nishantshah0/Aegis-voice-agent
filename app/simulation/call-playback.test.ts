import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallPlayback } from "./call-playback";
import { readTestEvents, requestTest, type TestEvent } from "./live-events";
import { failureCases } from "./failure-cases";
import { replayClips } from "./replay-clips";
import { stat } from "node:fs/promises";
import { join } from "node:path";

class FakeAudio {
  static instance: FakeAudio;
  src = "";
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(async () => { this.onplaying?.(); });
  constructor() { FakeAudio.instance = this; }
}

describe("simulation call playback", () => {
  beforeEach(() => { vi.stubGlobal("Audio", FakeAudio); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("includes a nonempty local audio clip for every original line in both public examples", async () => {
    for (const c of failureCases) {
      for (const line of c.transcript) {
        const url = replayClips[c.id][line.line];
        expect(url).toMatch(/^\/demo\/failure-replay\/[\w-]+\.mp3$/);
        expect((await stat(join(process.cwd(), "public", url))).size).toBeGreaterThan(100);
      }
    }
  });

  it("highlights one spoken line at a time and resumes the same media element after pause", () => {
    const player = new CallPlayback([{ url: "/one" }, { url: "/two" }], true);
    player.play();
    const a = FakeAudio.instance;
    expect(a.src).toBe("/one");
    expect(player.snapshot()).toMatchObject({ mode: "playing", index: 0 });
    player.pause();
    expect(a.pause).toHaveBeenCalled();
    player.play();
    expect(FakeAudio.instance).toBe(a);
    a.onended?.();
    expect(player.snapshot()).toMatchObject({ mode: "playing", index: 1 });
    expect(a.src).toBe("/two");
    a.onended?.();
    expect(player.snapshot().mode).toBe("done");
    player.stop();
    expect(player.snapshot()).toMatchObject({ mode: "idle", index: 0 });
  });

  it("accepts more live lines and a final verdict while a prior audio request is waiting", async () => {
    let reply!: (r: Response) => void;
    const fetchClip = vi.fn(() => new Promise<Response>(resolve => { reply = resolve; }));
    vi.stubGlobal("fetch", fetchClip);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:spoken");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const p = new CallPlayback();
    p.play();
    expect(FakeAudio.instance.src).toMatch(/^data:audio\/wav/);
    p.append({ skip: true }); // Displayed verification placeholder.
    p.append({ ticket: "signed-line" });
    p.append({ url: "/last" });
    p.finish();
    expect(p.snapshot()).toMatchObject({ mode: "loading", index: 1 });
    p.pause();
    reply(new Response(new Uint8Array([1, 2, 3])));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(p.snapshot().mode).toBe("paused");
    p.play();
    expect(FakeAudio.instance.src).toBe("blob:spoken");
    FakeAudio.instance.onended?.();
    expect(p.snapshot()).toMatchObject({ mode: "playing", index: 2 });
    FakeAudio.instance.onended?.();
    expect(p.snapshot().mode).toBe("done");
    expect(fetchClip).toHaveBeenCalledTimes(1);
    p.dispose();
    expect(revoked).toHaveBeenCalledWith("blob:spoken");
  });

  it("can resume a live clip from an explicit user gesture after the browser blocks autoplay", async () => {
    const p = new CallPlayback();
    p.play();
    const a = FakeAudio.instance;
    a.play.mockRejectedValueOnce(new DOMException("Click to play", "NotAllowedError"));
    p.append({ url: "/spoken.mp3" });
    p.finish();
    await vi.waitFor(() => expect(p.snapshot().mode).toBe("blocked"));
    p.play();
    expect(a.src).toBe("/spoken.mp3");
    expect(p.snapshot()).toMatchObject({ mode: "playing", index: 0 });
    a.onended?.();
    expect(p.snapshot().mode).toBe("done");
  });

  it("aborts an in-flight audio load and ignores its late completion after stop", async () => {
    let signal: AbortSignal | undefined;
    let reply!: (r: Response) => void;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>(resolve => { reply = resolve; });
    });
    const p = new CallPlayback([{ ticket: "line" }], true);
    p.play(); p.stop();
    expect(signal?.aborted).toBe(true);
    reply(new Response(new Uint8Array([1])));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(p.snapshot()).toMatchObject({ mode: "idle", index: 0 });
  });
});

describe("live stream", () => {
  it("requests the latest saved attempt with GET and never starts a new model run", async () => {
    const get = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", get);
    try {
      const signal = new AbortController().signal;
      const response = await requestTest("saved", "corrected_consultation_time", signal);
      expect(response.status).toBe(404);
      expect(get).toHaveBeenCalledExactlyOnceWith("/api/simulation/live/latest?scenarioId=corrected_consultation_time", {
        method: "GET", cache: "no-store", signal,
      });
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps source order across fragmented NDJSON, multi-byte UTF-8 and a final line without a newline", async () => {
    const events: TestEvent[] = [
      { type: "start", scenarioId: "greeting_slang_recovery" },
      { type: "line", speaker: "caller", text: "hé" },
      { type: "action", label: "Checked appointment availability" },
      { type: "check", label: "Recovered", passed: true },
      { type: "verdict", passed: true, caught: 0, broken: 0 },
    ];
    const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e)).join("\n"));
    const response = new Response(new ReadableStream({
      start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); },
    }));
    const received: TestEvent[] = [];
    await readTestEvents(response, event => received.push(event));
    expect(received).toEqual(events);
  });

  it("reports an interrupted stream instead of inventing a verdict", async () => {
    const line = JSON.stringify({ type: "line", speaker: "pharmacy", text: "Hello" });
    await expect(readTestEvents(new Response(line), () => {})).rejects.toThrow("before the test returned a verdict");
  });
});
