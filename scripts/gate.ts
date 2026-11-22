// AUDIT #9 (Trail #78): the release gate as one command. Runs the same checks as GitHub's
// Release gate (typecheck, lint, tests, the hammers, build) on this checkout and saves the
// result, with the commit and time, to results/gate/<run>.json. GET /api/gate/latest and the
// Release gate page read those files and nothing else.
//
//   node scripts/gate.ts            (tests run with DATABASE_URL empty, so the shared DB is never reset)
//
// Plain node (no @/ imports), so it runs without a build step.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type GateCheck = {
  name: string;
  passed: boolean;
  /** Required checks decide pass or fail. Others are shown for information. */
  required: boolean;
  detail: string;
  ms: number;
};

export type GateRun = {
  ranAt: string;
  passed: boolean;
  commit: string;
  branch: string;
  /** True when the checkout had uncommitted changes, so the commit alone doesn't describe what ran. */
  dirty: boolean;
  checks: GateCheck[];
  ms: number;
};

export const gateDir = (root = process.cwd()) => join(process.env.RESULTS_DIR ?? join(/* turbopackIgnore: true */ root, "results"), "gate");

// ---------- parsing what each command prints ----------

/** Vitest's summary line, e.g. "Tests  907 passed | 1 expected fail | 10 skipped (918)". */
export function parseTests(output: string): { passed: number; failed: number; skipped: number } | null {
  const line = output.split("\n").find((l) => /^\s*Tests\s+/.test(l));
  if (!line) return null;
  const n = (word: string) => Number(line.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? 0);
  return { passed: n("passed"), failed: n("failed"), skipped: n("skipped") };
}

/** ESLint's "✖ 3 problems (1 error, 2 warnings)", or none when clean. */
export function parseLint(output: string): { errors: number; warnings: number } {
  const m = output.match(/✖ \d+ problems? \((\d+) errors?, (\d+) warnings?\)/);
  return m ? { errors: Number(m[1]), warnings: Number(m[2]) } : { errors: 0, warnings: 0 };
}

/** results/hammer-latest.json as the hammer test writes it. */
export function summariseHammer(json: unknown): { ranAt: string; sequences: number; presses: number; broken: number } | null {
  const file = json as { ranAt?: unknown; reports?: { sequences?: unknown; presses?: unknown; broken?: unknown }[] } | null;
  if (!file || typeof file.ranAt !== "string" || !Array.isArray(file.reports)) return null;
  const sum = (k: "sequences" | "presses" | "broken") => file.reports!.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  return { ranAt: file.ranAt, sequences: sum("sequences"), presses: sum("presses"), broken: sum("broken") };
}

/** The newest saved scenario-suite scoreboard, for information (live-agent runs aren't deterministic gate checks). */
export function newestSuite(resultsRoot: string): { path: string; passed: number; scenarios: number; completed: boolean; broken: number } | null {
  const root = join(resultsRoot, "arena", "scenarios");
  if (!existsSync(root)) return null;
  const boards = readdirSync(root)
    .map((d) => join(root, d, "scoreboard.json"))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const path of boards) {
    try {
      const f = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" ? v : 0);
      return { path, passed: num(f.passed), scenarios: num(f.totalScenarios), completed: f.completed === true, broken: num(f.broken) };
    } catch {
      // Unreadable board: try the next one.
    }
  }
  return null;
}

export function gateRun(parts: Omit<GateRun, "passed">): GateRun {
  return { ...parts, passed: parts.checks.every((c) => !c.required || c.passed) };
}

// ---------- reading saved runs ----------

/** Saved gate runs, newest first. Files that aren't gate runs are skipped. */
export function readGateRuns(dir = gateDir()): GateRun[] {
  if (!existsSync(dir)) return [];
  const runs: GateRun[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const run = JSON.parse(readFileSync(join(/* turbopackIgnore: true */ dir, name), "utf8")) as GateRun;
      if (typeof run.ranAt === "string" && typeof run.passed === "boolean" && Array.isArray(run.checks)) runs.push(run);
    } catch {
      // Not a gate run.
    }
  }
  return runs.sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt));
}

// ---------- running ----------

function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; output: string; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code: code ?? 1, output, ms: Date.now() - start }));
  });
}

const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const tail = (output: string) => output.trim().split("\n").slice(-3).join(" ").slice(0, 300);

export async function runGate(root = process.cwd()): Promise<{ path: string; run: GateRun }> {
  const started = Date.now();
  const ranAt = new Date(started).toISOString();
  // Checked before running anything: the hammer step itself rewrites results/hammer-latest.json.
  const dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
  const checks: GateCheck[] = [];

  const typecheck = await run("npm", ["run", "typecheck"]);
  checks.push({ name: "Typecheck", required: true, passed: typecheck.code === 0, detail: typecheck.code === 0 ? "No type errors" : tail(typecheck.output), ms: typecheck.ms });

  const lint = await run("npm", ["run", "lint"]);
  const lintCounts = parseLint(lint.output);
  checks.push({ name: "Lint", required: true, passed: lint.code === 0 && lintCounts.errors === 0, detail: `${lintCounts.errors} errors, ${lintCounts.warnings} warnings`, ms: lint.ms });

  // DATABASE_URL empty: the tests reset their store, and must never reset the shared demo DB.
  const tests = await run("npm", ["test"], { DATABASE_URL: "" });
  const counts = parseTests(tests.output);
  checks.push({
    name: "Tests",
    required: true,
    passed: tests.code === 0 && counts !== null && counts.failed === 0,
    detail: counts ? `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped` : tail(tests.output),
    ms: tests.ms,
  });

  const hammer = await run("npm", ["run", "hammer"], { DATABASE_URL: "" });
  const hammerFile = join(root, "results", "hammer-latest.json");
  const summary = existsSync(hammerFile) ? summariseHammer(JSON.parse(readFileSync(hammerFile, "utf8"))) : null;
  const fresh = summary !== null && Date.parse(summary.ranAt) >= started;
  checks.push({
    name: "Hammers (0 rules broken)",
    required: true,
    passed: hammer.code === 0 && fresh && summary!.broken === 0,
    detail: summary && fresh ? `${summary.sequences.toLocaleString("en-US")} sequences, ${summary.presses.toLocaleString("en-US")} presses, ${summary.broken} broken` : "No fresh results/hammer-latest.json from this run",
    ms: hammer.ms,
  });

  const build = await run("npm", ["run", "build"]);
  checks.push({ name: "Build", required: true, passed: build.code === 0, detail: build.code === 0 ? "next build ok" : tail(build.output), ms: build.ms });

  const suite = newestSuite(join(root, "results"));
  checks.push({
    name: "Scenario suite (live agent, saved run)",
    required: false,
    passed: suite !== null && suite.completed && suite.broken === 0 && suite.passed === suite.scenarios,
    detail: suite ? `${suite.passed} of ${suite.scenarios} passed${suite.completed ? "" : " (run not finished)"}, ${suite.broken} broken` : "No saved suite run",
    ms: 0,
  });

  const result = gateRun({
    ranAt,
    commit: git("rev-parse", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty,
    checks,
    ms: Date.now() - started,
  });
  const dir = gateDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return { path, run: result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runGate().then(({ path, run: result }) => {
    for (const c of result.checks) console.log(`${c.passed ? "PASS" : c.required ? "FAIL" : "info"}  ${c.name}: ${c.detail}`);
    console.log(`${result.passed ? "Releasable" : "Not releasable"} · ${result.commit.slice(0, 7)} · saved ${path}`);
    process.exit(result.passed ? 0 : 1);
  });
}
