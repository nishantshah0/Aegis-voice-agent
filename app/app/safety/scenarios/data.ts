import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecordEntry } from "@/lib/contract";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import type { SuiteReport, SuiteScenario } from "@/lib/arena/suite";
import type { ScenarioRun } from "@/lib/arena/runner";

// Read-only: the team's scenario cards (scenarios/) and the latest saved suite run
// (results/arena/scenarios/<run>/). Nothing here runs a scenario or writes a file.

const resultsDir = () => join(process.env.RESULTS_DIR ?? join(process.cwd(), "results"), "arena", "scenarios");

type Card = SuiteScenario & { persona?: string; goal?: string; plan?: string; expected: SuiteScenario["expected"] & { must?: string[]; must_not?: string[] } };

export type ScenarioStatus = "passed" | "failed" | "not_run";
export type ScenarioRow = {
  id: string;
  group: string;
  persona: string;
  goal: string;
  direction: "inbound" | "outbound";
  needsPharmacist: boolean;
  status: ScenarioStatus;
  attempts: number;
};

export type LatestRun = { runId: string; ranAt: string; report: SuiteReport };

export const groupLabel = (group: string) => group.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The newest run folder that has a scoreboard, or null when none has been saved. */
export async function latestRun(): Promise<LatestRun | null> {
  const dir = resultsDir();
  const runs = await readdir(dir).catch(() => [] as string[]);
  let best: { runId: string; mtime: number } | null = null;
  for (const runId of runs) {
    const info = await stat(join(dir, runId, "scoreboard.json")).catch(() => null);
    if (info && (!best || info.mtimeMs > best.mtime)) best = { runId, mtime: info.mtimeMs };
  }
  if (!best) return null;
  try {
    const report = JSON.parse(await readFile(join(dir, best.runId, "scoreboard.json"), "utf8")) as SuiteReport;
    return { runId: best.runId, ranAt: new Date(best.mtime).toISOString(), report };
  } catch {
    return null;
  }
}

export async function scenarioRows(): Promise<{ rows: ScenarioRow[]; run: LatestRun | null }> {
  const [cards, run] = await Promise.all([loadScenarioSuite() as Promise<Card[]>, latestRun()]);
  const outcomes = new Map((run?.report.scenarios ?? []).map((s) => [s.id, s]));
  const rows = cards.map((card): ScenarioRow => {
    const outcome = outcomes.get(card.id);
    return {
      id: card.id,
      group: card.group,
      persona: card.persona ?? card.id,
      goal: card.goal ?? "",
      direction: card.direction ?? "inbound",
      needsPharmacist: Boolean(card.needsPharmacist),
      status: outcome ? (outcome.passed ? "passed" : "failed") : "not_run",
      attempts: outcome?.attempts.length ?? 0,
    };
  });
  return { rows, run };
}

export type ScenarioDetail = {
  card: Card;
  run: LatestRun | null;
  attempts: { n: number; run: ScenarioRun | null; score: SuiteReport["scenarios"][number]["attempts"][number] }[];
};

export async function scenarioDetail(id: string): Promise<ScenarioDetail | null> {
  const cards = (await loadScenarioSuite()) as Card[];
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  const run = await latestRun();
  const outcome = run?.report.scenarios.find((s) => s.id === id);
  const attempts = await Promise.all(
    (outcome?.attempts ?? []).map(async (score, i) => {
      const path = join(resultsDir(), run!.runId, "attempts", encodeURIComponent(id), `${i + 1}.json`);
      const saved = await readFile(path, "utf8").then((t) => JSON.parse(t) as ScenarioRun).catch(() => null);
      return { n: i + 1, run: saved, score };
    }),
  );
  return { card, run, attempts };
}

/** A one-line description of a record entry for the drill-down. */
export function describeEntry(e: RecordEntry): string {
  const parts = [e.kind.replace(/_/g, " ")];
  if (e.button) parts.push(e.button);
  if (e.decision) parts.push(`→ ${e.decision}`);
  if (e.ruleIds?.length) parts.push(`rule ${e.ruleIds.join(", ")}`);
  return parts.join(" ");
}
