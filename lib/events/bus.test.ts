import { afterEach, describe, expect, it } from "vitest";
import { emit, eventsSince, resetBusForTests, subscribe } from "./bus";
import type { Delivered } from "./types";

const clockEvent = (now: string) => ({ type: "clock" as const, now });

afterEach(() => resetBusForTests());

describe("event bus", () => {
  it("delivers each emitted event to every listener with rising ids", () => {
    const a: Delivered[] = [];
    const b: Delivered[] = [];
    subscribe((d) => a.push(d));
    subscribe((d) => b.push(d));
    emit(clockEvent("2026-01-01T00:00:00.000Z"));
    emit(clockEvent("2026-01-02T00:00:00.000Z"));
    expect(a.map((d) => d.id)).toEqual([1, 2]);
    expect(b).toEqual(a);
    expect(a[1].event).toEqual(clockEvent("2026-01-02T00:00:00.000Z"));
  });

  it("stops delivering after unsubscribe", () => {
    const got: Delivered[] = [];
    const stop = subscribe((d) => got.push(d));
    emit(clockEvent("2026-01-01T00:00:00.000Z"));
    stop();
    emit(clockEvent("2026-01-02T00:00:00.000Z"));
    expect(got).toHaveLength(1);
  });

  it("keeps going when one listener throws", () => {
    const got: Delivered[] = [];
    subscribe(() => {
      throw new Error("broken page");
    });
    subscribe((d) => got.push(d));
    expect(() => emit(clockEvent("2026-01-01T00:00:00.000Z"))).not.toThrow();
    expect(got).toHaveLength(1);
  });

  it("replays events after a given id, up to the buffer size", () => {
    for (let i = 0; i < 205; i++) emit(clockEvent(new Date(i * 1000).toISOString()));
    expect(eventsSince(203).map((d) => d.id)).toEqual([204, 205]);
    expect(eventsSince(0)).toHaveLength(200);
    expect(eventsSince(0)[0].id).toBe(6);
  });
});
