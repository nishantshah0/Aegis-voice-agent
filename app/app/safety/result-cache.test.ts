import { afterEach, expect, it, vi } from "vitest";
import { cacheResult } from "./result-cache";

afterEach(() => vi.useRealTimers());

it("shares concurrent reads and refreshes by directory and expiry", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async (dir: string) => dir);
  const read = cacheResult(load);
  const first = read("a");
  expect(read("a")).toBe(first);
  await expect(first).resolves.toBe("a");
  vi.advanceTimersByTime(14_999);
  expect(read("a")).toBe(first);
  vi.advanceTimersByTime(1);
  expect(read("a")).not.toBe(first);
  await expect(read("b")).resolves.toBe("b");
  expect(load).toHaveBeenCalledTimes(3);
});

it("allows a failed read to retry", async () => {
  const load = vi.fn(async () => "saved").mockRejectedValueOnce(new Error("unavailable"));
  const read = cacheResult(load);
  await expect(read("a")).rejects.toThrow("unavailable");
  await expect(read("a")).resolves.toBe("saved");
});
