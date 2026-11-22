// Each loader keeps one summary per process. Live data uses its own read path.
export function cacheResult<T>(load: (dir: string) => Promise<T>) {
  let cached: { dir: string; value: Promise<T>; expires: number } | undefined;
  return (dir: string): Promise<T> => {
    if (cached?.dir === dir && Date.now() < cached.expires) return cached.value;
    const entry = { dir, value: load(dir), expires: Infinity };
    cached = entry;
    void entry.value.then(
      () => { entry.expires = Date.now() + 15_000; },
      () => { if (cached === entry) cached = undefined; },
    );
    return entry.value;
  };
}
