import { expect, it } from "vitest";
import { runSuiteQueue } from "./suite-queue";

it.each([["sequential", 1], ["concurrent", 2]] as const)("runs %s with a bounded number of independent calls", async (mode, width) => {
  const started: number[] = [];
  const complete = new Map<number, () => void>();
  let peak = 0;
  const run = runSuiteQueue([1, 2, 3], mode, new AbortController().signal, async id => {
    started.push(id);
    await new Promise<void>(resolve => {
      complete.set(id, resolve);
      peak = Math.max(peak, complete.size);
    });
    complete.delete(id);
  });
  expect(started).toHaveLength(width);
  for (const id of mode === "concurrent" ? [2, 3, 1] : [1, 2, 3]) {
    expect(complete.has(id)).toBe(true);
    complete.get(id)!();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await run;
  expect(started).toEqual([1, 2, 3]);
  expect(peak).toBe(width);
});

it("leaves pending calls unstarted when the dashboard disconnects", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  await runSuiteQueue([1, 2, 3], "concurrent", controller.signal, async id => {
    started.push(id);
    await Promise.resolve();
    controller.abort();
  });
  expect(started).toEqual([1, 2]);
});
