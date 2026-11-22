import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hammerTotals } from "./hammer";

// Read-only figures for the landing's "How we test it" strip, all from results/.
// A layer with no saved run returns null: the page then shows no number for it.

const root = () => process.env.RESULTS_DIR ?? join(/* turbopackIgnore: true */ process.cwd(), "results");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const json = async (path: string) => JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as Record<string, unknown>;
const dirs = (path: string) => readdir(/* turbopackIgnore: true */ path, { withFileTypes: true }).then((e) => e.filter((d) => d.isDirectory()).map((d) => d.name), () => [] as string[]);

/** The newest hijack batch, by its timestamped folder name (file times don't survive a git checkout). Single-card "pick-" runs aren't batches. */
export async function hijackBatch(): Promise<{ cards: number; caught: number; broken: number } | null> {
  const base = join(root(), "hijack");
  const batch = (await dirs(base)).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort().at(-1);
  if (!batch) return null;
  const files = (await readdir(/* turbopackIgnore: true */ join(base, batch))).filter((f) => f.endsWith(".json"));
  const scores = await Promise.all(files.map(async (f) => (await json(join(base, batch, f))).score as Record<string, unknown> | undefined));
  const scored = scores.filter((s): s is Record<string, unknown> => Boolean(s));
  if (scored.length === 0) return null;
  return { cards: scored.length, caught: scored.reduce((n, s) => n + num(s.caught), 0), broken: scored.reduce((n, s) => n + num(s.broken), 0) };
}

/** The most recently written file named `name` one level under results/<area>. */
async function newest(area: string, name: string): Promise<Record<string, unknown> | null> {
  const base = join(root(), ...area.split("/"));
  let best: { path: string; at: number } | null = null;
  for (const d of await dirs(base)) {
    const path = join(base, d, name);
    const info = await stat(/* turbopackIgnore: true */ path).catch(() => null);
    if (info && (!best || info.mtimeMs > best.at)) best = { path, at: info.mtimeMs };
  }
  return best ? json(best.path).catch(() => null) : null;
}

export async function suiteScore(): Promise<{ passed: number; total: number } | null> {
  const s = await newest("arena/scenarios", "scoreboard.json");
  return s ? { passed: num(s.passed), total: num(s.totalScenarios) } : null;
}

export async function overnightScore(): Promise<{ calls: number; broken: number } | null> {
  const r = await newest("arena/overnight", "report.json");
  return r && typeof r.calls === "number" ? { calls: num(r.calls), broken: num(r.broken) } : null;
}

export { hammerTotals };
