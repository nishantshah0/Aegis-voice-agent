// Saved simulation runs: results/sim/<run>/{population,days,forecast,summary}.json.
// Server only (node:fs). The Outreach viewer reads these and nothing else.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generatePopulation, type Population } from "@/lib/seed/population";
import { runSim } from "./run";
import type { ForecastRow, SimDay, SimOptions, SimRun, SimSummary } from "./types";

export const simDir = () => join(process.env.RESULTS_DIR ?? join(/* turbopackIgnore: true */ process.cwd(), "results"), "sim");

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const isRunId = (id: string) => RUN_ID.test(id);

/** A run id from the clock and seeds, e.g. 2026-11-22T01-02-03Z-p20261124-o7. */
export function newRunId(opts: Pick<SimOptions, "populationSeed" | "outcomeSeed">, now = new Date()): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, "-")}Z-p${opts.populationSeed}-o${opts.outcomeSeed}`;
}

export type SavedRun = SimRun & { population: Population };

/** Generate the population, run the sim and save all four files. Returns the folder. */
export async function runAndSave(options: Partial<SimOptions> & { runId: string }, dir = simDir()): Promise<{ path: string; run: SavedRun }> {
  if (!isRunId(options.runId)) throw new Error(`bad run id: ${options.runId}`);
  const population = generatePopulation({ seed: options.populationSeed, size: options.populationSize });
  const run = await runSim(options, population);
  const path = join(dir, options.runId);
  await mkdir(/* turbopackIgnore: true */ path, { recursive: true });
  const write = (name: string, data: unknown) => writeFile(/* turbopackIgnore: true */ join(path, name), `${JSON.stringify(data)}\n`);
  await write("population.json", population);
  await write("days.json", run.days);
  await write("forecast.json", run.forecast);
  await write("summary.json", run.summary);
  return { path, run: { ...run, population } };
}

/** Saved runs, newest first. A folder without a readable summary.json is left out. */
export async function listRuns(dir = simDir()): Promise<SimSummary[]> {
  let names: string[];
  try {
    names = await readdir(/* turbopackIgnore: true */ dir);
  } catch {
    return [];
  }
  const summaries = await Promise.all(names.filter(isRunId).map(async (name): Promise<SimSummary | null> => {
    try {
      const summary = JSON.parse(await readFile(/* turbopackIgnore: true */ join(dir, name, "summary.json"), "utf8")) as SimSummary;
      return summary.simulated === true ? { ...summary, runId: name } : null;
    } catch {
      return null;
    }
  }));
  return summaries.filter((summary) => summary !== null).sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt));
}

/** One saved run, or null if it doesn't exist or isn't a simulation. */
export async function readRun(runId: string, dir = simDir()): Promise<SavedRun | null> {
  if (!isRunId(runId)) return null;
  try {
    const read = async <T>(name: string) => JSON.parse(await readFile(/* turbopackIgnore: true */ join(dir, runId, name), "utf8")) as T;
    const [summary, days, forecast, population] = await Promise.all([read<SimSummary>("summary.json"), read<SimDay[]>("days.json"), read<ForecastRow[]>("forecast.json"), read<Population>("population.json")]);
    if (summary.simulated !== true || population.simulated !== true) return null;
    return { summary: { ...summary, runId }, days, forecast, population };
  } catch {
    return null;
  }
}
