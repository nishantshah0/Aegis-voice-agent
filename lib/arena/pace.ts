import { readFile } from "node:fs/promises";
import { CALLS_PER_HOUR, USAGE_LOG } from "@/lib/agent/usage";

// Live runs (the suite, the overnight attacker) share Nishant's plan. Every process that
// runs the live agent writes one line per turn to results/agent-usage.jsonl, so pacing
// on that file keeps all of this machine's runs together under the hourly cap, and a
// turn never starts without room to finish.

const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 30_000;

/** Model calls logged in the hour before `now`. Each turn counts as at least one. */
export function hourlyUse(log: string, now: number): number {
  let used = 0;
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { at?: string; modelCalls?: number };
      const at = Date.parse(entry.at ?? "");
      if (Number.isFinite(at) && at > now - HOUR_MS) used += Math.max(1, Number(entry.modelCalls) || 0);
    } catch {
      // A torn or foreign line adds nothing.
    }
  }
  return used;
}

export const readUsageLog = (path = USAGE_LOG) => () => readFile(path, "utf8").catch(() => "");

/** Waits until `need` more model calls fit in the last hour. */
export async function waitForRoom({
  need,
  perHour = CALLS_PER_HOUR,
  readLog = readUsageLog(),
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  need: number;
  perHour?: number;
  readLog?: () => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  while (hourlyUse(await readLog(), now()) + need > perHour) await sleep(STEP_MS);
}
