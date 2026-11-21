import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "./types";
import { listenToEvents } from "./client";

// A stand-in for the browser's EventSource that the test drives by hand.
class FakeSource {
  static last: FakeSource;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  listeners: Record<string, (() => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeSource.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  hello() {
    this.listeners.hello?.forEach((fn) => fn());
  }
}

const ring: StreamEvent = { type: "phone", callId: "c_1", kind: "ring", text: "Maple Street Pharmacy is calling" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("listenToEvents", () => {
  it("stays on the stream when its hello arrives", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const got: StreamEvent[] = [];
    const stop = listenToEvents((e) => got.push(e));
    FakeSource.last.hello();
    FakeSource.last.onmessage!({ data: JSON.stringify(ring), lastEventId: "7" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toEqual([ring]);
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it("falls back to polling when the stream never says hello (e.g. behind a quick tunnel)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [], last: 5 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [{ id: 6, event: ring }], last: 6 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ events: [], last: 6 }) });
    vi.stubGlobal("fetch", fetchMock);
    const got: [StreamEvent, number][] = [];
    const stop = listenToEvents((e, id) => got.push([e, id]));
    const source = FakeSource.last;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(source.closed).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events/poll");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/poll?after=5");
    expect(got).toEqual([[ring, 6]]);
    stop();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
