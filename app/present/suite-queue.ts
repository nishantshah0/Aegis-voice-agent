// Workers share an iterator so a free slot immediately picks up the next selected call.
export async function runSuiteQueue<T>(
  selected: readonly T[],
  mode: "sequential" | "concurrent",
  signal: AbortSignal,
  runCall: (item: T) => Promise<void>,
) {
  const queued = selected.values();
  async function runWorker() {
    while (!signal.aborted) {
      const next = queued.next();
      if (next.done) return;
      await runCall(next.value);
    }
  }
  const workers = mode === "concurrent" ? Math.min(2, selected.length) : 1;
  await Promise.all(Array.from({ length: workers }, runWorker));
}
