import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { summarize, type LiveCall } from "@/app/api/_lib/live-calls";
import { resultsDir } from "@/app/console/overnight/results";
import { parseScoreboard } from "../data";

// "How we know it holds": every test layer's saved runs, read from results/ only. A layer
// with no file says so; nothing here is typed in. History (for the sparklines) is every
// saved run of a layer, oldest first; the hammer's history is its committed versions in git.

export type LayerKey = "hammer" | "hijack" | "scenarios" | "personas" | "overnight" | "live" | "phone";
export type Point = { at: string; value: number };
export type Latest = {
  at: string;
  broken: number;
  caught?: number;
  calls?: number;
  figures: [string, number | string][];
  /** Where to see the run in the app. */
  href: string;
  path?: string;
};
export type Layer = { runs: number; latest: Latest | null; history: Point[]; historyLabel: string; savedAt?: string };
export type Evals = { layers: Record<LayerKey, Layer>; hero: { broken: number | null; calls: number; presses: number; layers: number } };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const empty = (historyLabel: string): Layer => ({ runs: 0, latest: null, history: [], historyLabel });

async function json(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function dirs(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
}

const mtime = (path: string) => stat(path).then((s) => s.mtimeMs, () => 0);

// ---------- the hammer: results/hammer-latest.json, and its earlier versions in git ----------

function hammerTotals(file: unknown) {
  const reports = arr(obj(file).reports).map(obj);
  const sum = (k: string) => reports.reduce((n, r) => n + num(r[k]), 0);
  return { ranAt: str(obj(file).ranAt), sequences: sum("sequences"), presses: sum("presses"), checks: sum("checks"), broken: sum("broken") };
}

const run = promisify(execFile);

/** Earlier hammer runs, from the file's history in git (only when results/ is the repo's own). */
async function hammerHistory(dir: string): Promise<ReturnType<typeof hammerTotals>[]> {
  if (dir !== join(process.cwd(), "results")) return [];
  try {
    const { stdout } = await run("git", ["log", "-12", "--format=%H", "--", "results/hammer-latest.json"], { timeout: 3000 });
    const shas = stdout.split("\n").filter(Boolean);
    const files = await Promise.all(
      shas.map((sha) => run("git", ["show", `${sha}:results/hammer-latest.json`], { timeout: 3000 }).then((r) => hammerTotals(JSON.parse(r.stdout)), () => null)),
    );
    return files.filter((f): f is ReturnType<typeof hammerTotals> => f !== null).reverse();
  } catch {
    return []; // No git here (a deployed copy): the latest run still shows.
  }
}

async function readHammer(dir: string): Promise<Layer> {
  const path = join(dir, "hammer-latest.json");
  const file = await json(path);
  if (file === null) return empty("sequences per run");
  const latest = hammerTotals(file);
  const past = (await hammerHistory(dir)).filter((h) => h.ranAt !== latest.ranAt);
  const all = [...past, latest];
  return {
    runs: all.length,
    historyLabel: "sequences per run",
    history: all.map((h) => ({ at: h.ranAt, value: h.sequences })),
    latest: {
      at: latest.ranAt,
      broken: latest.broken,
      figures: [
        ["Sequences", latest.sequences],
        ["Presses", latest.presses],
        ["Invariant checks", latest.checks],
      ],
      href: "/app/safety/rules",
      path: "results/hammer-latest.json",
    },
  };
}

// ---------- the hijack batch: results/hijack/<batch>/<card>.json (a pick-* is one attack, not a batch) ----------

async function readHijack(dir: string): Promise<Layer> {
  const root = join(dir, "hijack");
  const batches = (
    await Promise.all(
      (await dirs(root))
        .filter((name) => !name.startsWith("pick-"))
        .map(async (name) => {
          const files = (await readdir(join(root, name)).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
          const cards = (await Promise.all(files.map((f) => json(join(root, name, f))))).map(obj).filter((c) => c.cardId);
          const times = await Promise.all(files.map((f) => mtime(join(root, name, f))));
          const score = (c: Record<string, unknown>) => obj(c.score);
          return {
            name,
            at: Math.max(0, ...times),
            cards: cards.length,
            caught: cards.reduce((n, c) => n + num(score(c).caught), 0),
            broken: cards.reduce((n, c) => n + num(score(c).broken), 0),
          };
        }),
    )
  )
    .filter((b) => b.cards > 0)
    .sort((a, b) => a.at - b.at);
  const latest = batches.at(-1);
  if (!latest) return empty("caught per batch");
  return {
    runs: batches.length,
    historyLabel: "caught per batch",
    history: batches.map((b) => ({ at: new Date(b.at).toISOString(), value: b.caught })),
    latest: {
      at: new Date(latest.at).toISOString(),
      broken: latest.broken,
      caught: latest.caught,
      calls: latest.cards,
      figures: [
        ["Attack calls", latest.cards],
        ["Caught", latest.caught],
        ["Broken", latest.broken],
      ],
      href: "/app/safety/attacks",
      path: `results/hijack/${latest.name}`,
    },
  };
}

// ---------- scripted scenarios: results/arena/scenarios/<run>/scoreboard.json ----------

async function readScenarios(dir: string): Promise<Layer> {
  const root = join(dir, "arena", "scenarios");
  const runs = (
    await Promise.all(
      (await dirs(root)).map(async (name) => {
        const path = join(root, name, "scoreboard.json");
        const file = await json(path);
        if (file === null) return null;
        const at = await mtime(path);
        return { name, at, board: parseScoreboard(file, { runId: name, dir: join(root, name), ranAt: new Date(at).toISOString(), runs: 0 }) };
      }),
    )
  )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.at - b.at);
  const latest = runs.at(-1);
  if (!latest) return empty("scenarios passing 3 of 3, per run");
  const b = latest.board;
  const calls = b.outcomes.reduce((n, o) => n + o.attempts.length, 0);
  return {
    runs: runs.length,
    historyLabel: "scenarios passing 3 of 3, per run",
    history: runs.map((r) => ({ at: new Date(r.at).toISOString(), value: r.board.passed })),
    latest: {
      at: new Date(latest.at).toISOString(),
      broken: b.broken,
      caught: b.caught,
      calls,
      figures: [
        ["Passing 3 of 3", `${b.passed} / ${b.outcomes.length || b.totalScenarios}`],
        ["Calls", calls],
        ["Caught", b.caught],
      ],
      href: "/app/safety/scenarios",
      path: `results/arena/scenarios/${latest.name}`,
    },
  };
}

// ---------- persona callers: results/arena/personas/<run>/ (Role 3's runner; shown once it saves) ----------

async function readPersonas(dir: string): Promise<Layer> {
  const root = join(dir, "arena", "personas");
  const names = await dirs(root);
  if (!names.length) return empty("runs");
  const times = await Promise.all(names.map((n) => mtime(join(root, n))));
  const at = new Date(Math.max(...times)).toISOString();
  return { runs: names.length, historyLabel: "runs", history: [], latest: null, savedAt: at };
}

// ---------- the overnight red team: results/arena/overnight/<run>/report.json ----------

async function readOvernight(dir: string): Promise<Layer> {
  const root = join(dir, "arena", "overnight");
  const runs = (
    await Promise.all(
      (await dirs(root)).map(async (name) => {
        const file = obj(await json(join(root, name, "report.json")));
        if (!Object.keys(file).length) return null;
        return { name, at: str(file.ranAt), calls: num(file.calls), caught: num(file.caught), broken: num(file.broken), gaps: arr(file.gaps).length };
      }),
    )
  )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const latest = runs.at(-1);
  if (!latest) return empty("caught per night");
  return {
    runs: runs.length,
    historyLabel: "caught per night",
    history: runs.map((r) => ({ at: r.at, value: r.caught })),
    latest: {
      at: latest.at,
      broken: latest.broken,
      caught: latest.caught,
      calls: latest.calls,
      figures: [
        ["Attack calls", latest.calls],
        ["Caught", latest.caught],
        ["Gaps found", latest.gaps],
      ],
      href: "/app/safety/overnight",
      path: `results/arena/overnight/${latest.name}`,
    },
  };
}

// ---------- live attack calls: results/arena/live/<id>.json ----------

async function readLive(dir: string): Promise<Layer> {
  const root = join(dir, "arena", "live");
  const files = (await readdir(root).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const calls = (await Promise.all(files.map((f) => json(join(root, f)))))
    .filter((c): c is LiveCall => obj(c).state === "ended" && Array.isArray(obj(c).turns))
    .map((c) => summarize(c));
  if (!calls.length) return empty("caught per call");
  const ordered = [...calls].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const newest = ordered.at(-1)!;
  const broken = calls.reduce((n, c) => n + c.broken, 0);
  const caught = calls.reduce((n, c) => n + c.caught, 0);
  return {
    runs: calls.length,
    historyLabel: "caught per call",
    history: ordered.map((c) => ({ at: c.startedAt, value: c.caught })),
    latest: {
      at: newest.startedAt,
      broken,
      caught,
      calls: calls.length,
      figures: [
        ["Calls", calls.length],
        ["Caught", caught],
        ["Records verified", `${calls.filter((c) => c.recordVerified).length} / ${calls.length}`],
      ],
      href: `/app/safety/calls/${newest.id}`,
      path: "results/arena/live/",
    },
  };
}

// ---------- everything ----------

export async function readEvals(dir: string = resultsDir()): Promise<Evals> {
  const [hammer, hijack, scenarios, personas, overnight, live] = await Promise.all([
    readHammer(dir),
    readHijack(dir),
    readScenarios(dir),
    readPersonas(dir),
    readOvernight(dir),
    readLive(dir),
  ]);
  const layers = { hammer, hijack, scenarios, personas, overnight, live, phone: empty("calls") };
  const withRuns = Object.values(layers).filter((l) => l.latest !== null);
  return {
    layers,
    hero: {
      broken: withRuns.length ? withRuns.reduce((n, l) => n + (l.latest?.broken ?? 0), 0) : null,
      calls: withRuns.reduce((n, l) => n + (l.latest?.calls ?? 0), 0),
      presses: num(hammer.latest?.figures.find(([k]) => k === "Presses")?.[1]),
      layers: withRuns.length,
    },
  };
}
