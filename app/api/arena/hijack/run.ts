import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runHijackBatch, type HijackBatchRun } from "@/lib/arena/hijack-batch";
import { emit } from "@/lib/events";
import { SEED } from "@/lib/seed";

// Runs Role 3's hijack batch (four attack cards, each on its own store and the real lock)
// and saves each card's real result under results/hijack/<run>/ before its score event.
// One batch at a time.

const holder = globalThis as typeof globalThis & { __refillGuardHijackRunning?: boolean };

export const hijackRunning = (): boolean => holder.__refillGuardHijackRunning === true;

const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");

export async function runHijackNow(opts: { pause?: () => Promise<void> } = {}): Promise<{ runDir: string; runs: HijackBatchRun[] }> {
  if (hijackRunning()) throw new Error("A hijack batch is already running");
  holder.__refillGuardHijackRunning = true;
  try {
    const runDir = join(resultsDir(), "hijack", new Date().toISOString().replace(/[:.]/g, "-"));
    await mkdir(runDir, { recursive: true });
    const runs = await runHijackBatch({
      seed: SEED,
      // The code the attack scripts use on their own isolated stores; random per batch.
      code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      emit,
      saveResult: (run) => writeFile(join(runDir, `${run.cardId}.json`), JSON.stringify(run, null, 2)),
      ...(opts.pause ? { pause: opts.pause } : {}),
    });
    return { runDir, runs };
  } finally {
    holder.__refillGuardHijackRunning = false;
  }
}
