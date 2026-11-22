import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { rescoreSuite } from "./rescore";
import type { ScenarioRun } from "./runner";
import { loadScenarioSuite } from "./suite-files";

// Rescore saved live-suite runs with today's scorer and write one combined scoreboard.
// No model calls. Opt in:
//   RESCORE=1 RESCORE_PARTS=<run dir>,<run dir> npx vitest run lib/arena/rescore.run.test.ts
// A run dir holds attempts/<scenario>/<n>.json (today's runner) or runs/<scenario>-<n>.json
// (the first live run). Each scenario's attempts come from the first part with all 3.
// RESCORE_MODEL names the agent model the parts ran on (check the usage log).
// Writes <RESCORE_OUT or results/arena/scenarios>/<new id>/ (scoreboard.json, attempts/).

async function attemptsIn(dir: string): Promise<Map<string, ScenarioRun[]>> {
  const found = new Map<string, { n: number; run: ScenarioRun }[]>();
  const add = (id: string, n: number, run: ScenarioRun) => found.set(id, [...(found.get(id) ?? []), { n, run }]);
  const read = async (path: string) => JSON.parse(await readFile(path, "utf8")) as ScenarioRun;
  for (const sub of await readdir(join(dir, "attempts")).catch(() => [])) {
    for (const file of (await readdir(join(dir, "attempts", sub))).filter((f) => /^\d+\.json$/.test(f))) add(decodeURIComponent(sub), Number(basename(file, ".json")), await read(join(dir, "attempts", sub, file)));
  }
  for (const file of (await readdir(join(dir, "runs")).catch(() => [])).filter((f) => f.endsWith(".json"))) {
    const run = await read(join(dir, "runs", file));
    add(run.scenarioId, Number(/-(\d+)\.json$/.exec(file)?.[1]), run);
  }
  return new Map([...found].map(([id, list]) => [id, list.sort((a, b) => a.n - b.n).map((x) => x.run)]));
}

describe.skipIf(process.env.RESCORE !== "1")("rescore saved live-suite runs", () => {
  it("writes one combined scoreboard scored with today's scorer", async () => {
    const parts = (process.env.RESCORE_PARTS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    expect(parts.length, "set RESCORE_PARTS").toBeGreaterThan(0);
    const scenarios = await loadScenarioSuite();
    const runs = new Map<string, ScenarioRun[]>();
    const used: { dir: string; scenarios: string[]; retried: number }[] = [];
    let retried = 0;
    for (const dir of parts) {
      const saved = await attemptsIn(dir);
      const board = JSON.parse(await readFile(join(dir, "scoreboard.json"), "utf8").catch(() => "{}")) as { retried?: number };
      const taken = scenarios.filter((s) => !runs.has(s.id) && (saved.get(s.id)?.length ?? 0) >= 3).map((s) => s.id);
      for (const id of taken) runs.set(id, saved.get(id)!.slice(0, 3));
      retried += board.retried ?? 0;
      used.push({ dir: basename(dir), scenarios: taken, retried: board.retried ?? 0 });
    }
    const report = rescoreSuite(scenarios, runs, retried);
    const out = join(process.env.RESCORE_OUT || join(process.cwd(), "results", "arena", "scenarios"), randomUUID());
    for (const [id, list] of runs) {
      await mkdir(join(out, "attempts", encodeURIComponent(id)), { recursive: true });
      for (const [i, run] of list.entries()) await writeFile(join(out, "attempts", encodeURIComponent(id), `${i + 1}.json`), `${JSON.stringify(run, null, 2)}\n`);
    }
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const rescored = { at: new Date().toISOString(), scorer: `lib/arena/score.ts at ${commit}`, parts: used, note: "Saved records scored again; no model calls. Each part's own scoreboard keeps the score it had when it ran." };
    await writeFile(join(out, "scoreboard.json"), `${JSON.stringify({ ...(process.env.RESCORE_MODEL ? { model: process.env.RESCORE_MODEL } : {}), ...report, rescored }, null, 2)}\n`);
    console.log(`[rescore] ${out}: ${report.passed}/${report.totalScenarios} passing 3 of 3, caught ${report.caught}, broken ${report.broken}, complete ${report.completed}`);
    expect(report.scenarios.length).toBeGreaterThan(0);
  });
});
