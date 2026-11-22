import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { INVARIANTS } from "@/scripts/hammer/invariants";

// What the Overnight safety tab shows, read only from files real runs saved under
// results/. Nothing here is typed in: a missing file is "no run yet", and a file we
// can't read is reported as such. When Role 3's overnight run (3.7) writes
// results/arena/overnight/<run>/report.json, this picks it up.

export const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");

export const COMMANDS = {
  hammer: "npm run hammer",
  suite: "Run suite on the Scenarios page (POST /api/arena/run)",
  hijack: "Run batch on the Attacks page or /stage (POST /api/arena/hijack)",
  overnight: "Run overnight on this page (POST /api/arena/overnight)",
} as const;

export type Source<T> =
  | { state: "none"; where: string; command: string }
  | { state: "error"; path: string; message: string; command: string }
  | { state: "ok"; path: string; ranAt: string; data: T };

export type Fix = { status: string; trail?: string };
export type Gap = { source: "overnight" | "suite" | "hijack" | "hammer"; scenario: string; detail: string; fix: Fix };
export type Replay = { source: "hijack" | "hammer"; title: string; steps: string[]; path: string; command: string };

type HammerFailure = { sequence: string[]; broken: { rule: string; detail: string }[] };
export type HammerView = {
  depth: number;
  sequences: number;
  presses: number;
  checks: number;
  broken: number;
  invariants: { names: string[]; from: "run" | "code" };
  failures: HammerFailure[];
};
export type SuiteView = {
  batches: number;
  scenarios: number;
  completed: boolean;
  passed: number;
  attempts: number;
  caught: number;
  broken: number;
  failed: { id: string; group: string }[];
};
type HijackCardRun = { cardId: string; callId: string; passed: boolean; failedChecks: string[]; caught: number; broken: number; path: string; steps: string[] };
export type HijackView = { batches: number; cards: number; caught: number; broken: number; runs: HijackCardRun[] };
export type NightView = { calls: number; caught: number; broken: number; gaps: Gap[] };

export type OvernightView = {
  hammer: Source<HammerView>;
  suite: Source<SuiteView>;
  hijack: Source<HijackView>;
  overnight: Source<NightView>;
  /** Summed over the sources that have a file; null when none do. */
  totals: { calls: number; caught: number; broken: number } | null;
  gaps: Gap[];
  replay: Replay | null;
};

const NO_FIX: Fix = { status: "no fix yet" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function subdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(path, e.name));
  } catch {
    return [];
  }
}

/** Reads one JSON file into a Source, or "none" if it isn't there. */
async function readSource<T>(path: string, where: string, command: string, parse: (json: unknown, mtime: Date) => { ranAt: string; data: T }): Promise<Source<T>> {
  if (!(await exists(path))) return { state: "none", where, command };
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { state: "ok", path, ...parse(JSON.parse(text), info.mtime) };
  } catch (err) {
    return { state: "error", path, message: err instanceof Error ? err.message : String(err), command };
  }
}

/** The newest file named `file` in any subfolder of `root`, by modified time, and how many there are. */
async function newest(root: string, file: string): Promise<{ path: string; count: number } | null> {
  const found = await Promise.all(
    (await subdirs(root)).map(async (d) => {
      const path = join(d, file);
      return stat(path).then((s) => ({ path, mtime: s.mtimeMs }), () => null);
    }),
  );
  const files = found.filter((f): f is { path: string; mtime: number } => f !== null).sort((a, b) => b.mtime - a.mtime);
  return files[0] ? { path: files[0].path, count: files.length } : null;
}

// ---------- the hammer: results/hammer-latest.json ----------

function parseHammer(json: unknown): { ranAt: string; data: HammerView } {
  const file = obj(json);
  const reports = arr(file.reports).map(obj);
  const sum = (k: string) => reports.reduce((n, r) => n + num(r[k]), 0);
  const recorded = arr(file.invariants).filter((n): n is string => typeof n === "string");
  return {
    ranAt: str(file.ranAt),
    data: {
      depth: num(file.depth),
      sequences: sum("sequences"),
      presses: sum("presses"),
      checks: sum("checks"),
      broken: sum("broken"),
      invariants: recorded.length ? { names: recorded, from: "run" } : { names: [...INVARIANTS], from: "code" },
      failures: reports.flatMap((r) =>
        arr(r.failures).map((f) => ({
          sequence: arr(obj(f).sequence).map(str),
          broken: arr(obj(f).broken).map((b) => ({ rule: str(obj(b).rule), detail: str(obj(b).detail) })),
        })),
      ),
    },
  };
}

// ---------- the scenario suite: results/arena/scenarios/<run>/scoreboard.json ----------

function parseSuite(json: unknown, mtime: Date, batches: number): { ranAt: string; data: SuiteView } {
  const file = obj(json);
  const scenarios = arr(file.scenarios).map(obj);
  return {
    ranAt: mtime.toISOString(),
    data: {
      batches,
      scenarios: num(file.totalScenarios),
      completed: file.completed === true,
      passed: num(file.passed),
      attempts: scenarios.reduce((n, s) => n + arr(s.attempts).length, 0),
      caught: num(file.caught),
      broken: num(file.broken),
      failed: scenarios.filter((s) => s.passed === false).map((s) => ({ id: str(s.id), group: str(s.group) })),
    },
  };
}

// ---------- the hijack batch: results/hijack/<batch>/<card>.json ----------

/** One record entry as a line a person can read. */
export function describeEntry(entry: unknown): string {
  const e = obj(entry);
  const text = str(obj(e.input).text);
  const rules = arr(e.ruleIds).map(str).filter(Boolean);
  switch (e.kind) {
    case "caller_line":
      return `Caller: "${text}"`;
    case "line_spoken":
      return `Agent: "${text}"`;
    case "line_blocked": {
      const out = obj(e.output);
      return `Blocked line (${str(out.rule)}): "${text}" → said instead: "${str(out.replacement)}"`;
    }
    case "button":
      return `Pressed ${str(e.button)}: ${str(e.decision) || "no decision"}${rules.length ? ` (rule ${rules.join(", ")})` : ""}`;
    default:
      return `${str(e.kind) || "entry"}${str(e.decision) ? `: ${str(e.decision)}` : ""}${rules.length ? ` (rule ${rules.join(", ")})` : ""}`;
  }
}

/**
 * A judge's single pick on the stage saves to results/hijack/pick-<time>/, which isn't a batch.
 * Skipped here exactly as the Safety Overview skips it (readLatestBatch), so both read the same
 * batch (AUDIT #8).
 */
const isBatchDir = (dir: string): boolean => !basename(dir).startsWith("pick-");

async function readHijack(root: string): Promise<Source<HijackView>> {
  const batches = (
    await Promise.all(
      (await subdirs(root)).filter(isBatchDir).map(async (d) => {
        const files = (await readdir(d).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => join(d, f));
        const times = await Promise.all(files.map((f) => stat(f).then((s) => s.mtimeMs, () => 0)));
        return { dir: d, files, mtime: Math.max(0, ...times) };
      }),
    )
  )
    .filter((b) => b.files.length > 0)
    .sort((a, b) => b.mtime - a.mtime);
  const latest = batches[0];
  if (!latest) return { state: "none", where: join(root, "<batch>", "<card>.json"), command: COMMANDS.hijack };
  try {
    const read = await Promise.all(
      latest.files.map(async (path): Promise<HijackCardRun | null> => {
        const run = obj(JSON.parse(await readFile(path, "utf8")));
        if (!run.cardId) return null;
        const score = obj(run.score);
        return {
          cardId: str(run.cardId),
          callId: str(run.callId),
          passed: score.automatedPassed === true,
          failedChecks: arr(score.checks).map(obj).filter((c) => c.passed === false).map((c) => str(c.id)),
          caught: num(score.caught),
          broken: num(score.broken),
          path,
          steps: arr(run.record).map(describeEntry),
        };
      }),
    );
    const runs = read.filter((r): r is HijackCardRun => r !== null);
    return {
      state: "ok",
      path: latest.dir,
      ranAt: new Date(latest.mtime).toISOString(),
      data: {
        batches: batches.length,
        cards: runs.length,
        caught: runs.reduce((n, r) => n + r.caught, 0),
        broken: runs.reduce((n, r) => n + r.broken, 0),
        runs,
      },
    };
  } catch (err) {
    return { state: "error", path: latest.dir, message: err instanceof Error ? err.message : String(err), command: COMMANDS.hijack };
  }
}

// ---------- Role 3's overnight run: results/arena/overnight/<run>/report.json ----------

function parseNight(json: unknown, mtime: Date): { ranAt: string; data: NightView } {
  const file = obj(json);
  return {
    ranAt: str(file.ranAt) || mtime.toISOString(),
    data: {
      calls: num(file.calls),
      caught: num(file.caught),
      broken: num(file.broken),
      gaps: arr(file.gaps).map((g) => {
        const gap = obj(g);
        const fix = obj(gap.fix);
        const status = str(fix.status);
        return {
          source: "overnight" as const,
          scenario: str(gap.scenario),
          detail: str(gap.summary),
          fix: status ? { status, ...(str(fix.trail) ? { trail: str(fix.trail) } : {}) } : NO_FIX,
        };
      }),
    },
  };
}

// ---------- everything ----------

export async function readOvernight(dir: string = resultsDir()): Promise<OvernightView> {
  const suiteRoot = join(dir, "arena", "scenarios");
  const nightRoot = join(dir, "arena", "overnight");
  const [suiteFile, nightFile] = await Promise.all([newest(suiteRoot, "scoreboard.json"), newest(nightRoot, "report.json")]);

  const [hammer, suite, hijack, overnight] = await Promise.all([
    readSource(join(dir, "hammer-latest.json"), join(dir, "hammer-latest.json"), COMMANDS.hammer, parseHammer),
    suiteFile
      ? readSource(suiteFile.path, suiteFile.path, COMMANDS.suite, (json, mtime) => parseSuite(json, mtime, suiteFile.count))
      : Promise.resolve<Source<SuiteView>>({ state: "none", where: join(suiteRoot, "<run>", "scoreboard.json"), command: COMMANDS.suite }),
    readHijack(join(dir, "hijack")),
    nightFile
      ? readSource(nightFile.path, nightFile.path, COMMANDS.overnight, parseNight)
      : Promise.resolve<Source<NightView>>({ state: "none", where: join(nightRoot, "<run>", "report.json"), command: COMMANDS.overnight }),
  ]);

  const gaps: Gap[] = [];
  if (overnight.state === "ok") gaps.push(...overnight.data.gaps);
  if (suite.state === "ok") {
    for (const f of suite.data.failed) gaps.push({ source: "suite", scenario: f.id, detail: `${f.group}: didn't pass 3 runs out of 3`, fix: NO_FIX });
  }
  const brokenCards = hijack.state === "ok" ? hijack.data.runs.filter((r) => r.broken > 0 || !r.passed) : [];
  for (const r of brokenCards) gaps.push({ source: "hijack", scenario: r.cardId, detail: `failed checks: ${r.failedChecks.join(", ") || "none listed"}`, fix: NO_FIX });
  const hammerFailures = hammer.state === "ok" ? hammer.data.failures : [];
  for (const f of hammerFailures) {
    gaps.push({ source: "hammer", scenario: f.sequence.join(" → "), detail: f.broken.map((b) => b.rule).join(", "), fix: NO_FIX });
  }

  let replay: Replay | null = null;
  const card = brokenCards[0];
  if (card) {
    replay = { source: "hijack", title: `Hijack card ${card.cardId} (${card.callId})`, steps: card.steps, path: card.path, command: COMMANDS.hijack };
  } else if (hammer.state === "ok" && hammerFailures[0]) {
    replay = { source: "hammer", title: `Hammer sequence breaking: ${hammerFailures[0].broken.map((b) => b.rule).join(", ")}`, steps: hammerFailures[0].sequence, path: hammer.path, command: COMMANDS.hammer };
  }

  const parts = [
    suite.state === "ok" ? { calls: suite.data.attempts, caught: suite.data.caught, broken: suite.data.broken } : null,
    hijack.state === "ok" ? { calls: hijack.data.cards, caught: hijack.data.caught, broken: hijack.data.broken } : null,
    overnight.state === "ok" ? { calls: overnight.data.calls, caught: overnight.data.caught, broken: overnight.data.broken } : null,
    hammer.state === "ok" ? { calls: 0, caught: 0, broken: hammer.data.broken } : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  const totals = parts.length
    ? parts.reduce((t, p) => ({ calls: t.calls + p.calls, caught: t.caught + p.caught, broken: t.broken + p.broken }), { calls: 0, caught: 0, broken: 0 })
    : null;

  return { hammer, suite, hijack, overnight, totals, gaps, replay };
}
