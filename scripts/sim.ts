// Trail #67: run the outreach simulation and save it to results/sim/<run>/.
// Every patient is made up (lib/seed/population.ts) and every number is labelled simulated.
// It reads and predicts only: no button presses, no calls, no writes to the live store.
//
//   SIM=1 npx vitest run scripts/sim.run.test.ts
//   SIM=1 SIM_RUN=baseline SIM_OUTCOME_SEED=1 SIM_EARLY_REACH=on SIM_SIZE=240 npx vitest run scripts/sim.run.test.ts
//
// (vitest is the runner because lib/ imports use the @/ alias, which plain node can't resolve.)

import { DEFAULT_OPTIONS, newRunId, runAndSave } from "@/lib/sim";
import type { SimOptions } from "@/lib/sim";

export function optionsFromEnv(env: Record<string, string | undefined> = process.env): Partial<SimOptions> & { runId: string } {
  const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);
  const populationSeed = num(env.SIM_POPULATION_SEED, DEFAULT_OPTIONS.populationSeed);
  const outcomeSeed = num(env.SIM_OUTCOME_SEED, DEFAULT_OPTIONS.outcomeSeed);
  return {
    runId: env.SIM_RUN || newRunId({ populationSeed, outcomeSeed }),
    populationSeed,
    populationSize: num(env.SIM_SIZE, DEFAULT_OPTIONS.populationSize),
    outcomeSeed,
    days: num(env.SIM_DAYS, DEFAULT_OPTIONS.days),
    earlyReach: env.SIM_EARLY_REACH ? env.SIM_EARLY_REACH !== "off" : DEFAULT_OPTIONS.earlyReach,
  };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<string> {
  const { path, run } = await runAndSave(optionsFromEnv(env));
  const t = run.summary.totals;
  console.log(`Simulated run saved to ${path}`);
  console.log(`  ${t.patients} made-up patients, ${t.prescriptions} prescriptions, ${run.summary.days} days`);
  console.log(`  ${t.calls} calls (${t.callsNext7} in the first 7 days, ${t.earlyReachCalls} early reach), ${t.refills} refills, ${t.atRisk} high-risk patients`);
  return path;
}
