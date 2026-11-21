import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runScenarioSuite, type SuiteScenario } from "./suite";

export async function loadScenarioSuite(directory = join(process.cwd(), "scenarios")): Promise<SuiteScenario[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const cards = await Promise.all(files.map(async (file) => {
    const text = await readFile(join(directory, file), "utf8");
    return JSON.parse(text) as SuiteScenario & { source: "team" | "attacker"; suite?: "regression" };
  }));
  return cards.filter((card) => card.source === "team" && card.suite !== "regression");
}

export async function runFixedScenarioSuite(options: Omit<Parameters<typeof runScenarioSuite>[0], "scenarios" | "saveReport"> & {
  scenariosDirectory?: string;
  resultsDirectory?: string;
}) {
  const { scenariosDirectory, resultsDirectory = join(process.cwd(), "results", "arena", "scenarios"), ...suite } = options;
  const scenarios = await loadScenarioSuite(scenariosDirectory);
  const directory = join(resultsDirectory, randomUUID());
  const resultPath = join(directory, "scoreboard.json");
  const pendingPath = join(directory, "scoreboard.pending");
  await mkdir(directory, { recursive: true });
  const report = await runScenarioSuite({
    ...suite,
    scenarios,
    saveReport: async (snapshot) => {
      await writeFile(pendingPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      await rename(pendingPath, resultPath);
    },
  });
  return { report, resultPath };
}
