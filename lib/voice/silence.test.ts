import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SILENCE_PROMPT_MS, createSilenceWatch } from "./silence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("1.8: silence handling", () => {
  it("fires once after the silence, and not again until re-armed", () => {
    const fired: number[] = [];
    const watch = createSilenceWatch(() => fired.push(1));
    watch.arm();
    vi.advanceTimersByTime(SILENCE_PROMPT_MS - 1);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(SILENCE_PROMPT_MS * 3);
    expect(fired).toHaveLength(1);
    watch.arm();
    vi.advanceTimersByTime(SILENCE_PROMPT_MS);
    expect(fired).toHaveLength(2);
  });

  it("is cancelled by the caller talking or the agent speaking", () => {
    const fired: number[] = [];
    const watch = createSilenceWatch(() => fired.push(1));
    watch.arm();
    vi.advanceTimersByTime(SILENCE_PROMPT_MS / 2);
    watch.cancel();
    vi.advanceTimersByTime(SILENCE_PROMPT_MS);
    expect(fired).toHaveLength(0);
  });

  it("re-arming restarts the clock", () => {
    const fired: number[] = [];
    const watch = createSilenceWatch(() => fired.push(1), 1000);
    watch.arm();
    vi.advanceTimersByTime(800);
    watch.arm();
    vi.advanceTimersByTime(800);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(fired).toHaveLength(1);
  });
});
