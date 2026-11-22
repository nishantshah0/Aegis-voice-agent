import type { RecordEntry } from "@/lib/contract";
import { scenarioSeed, scenarioTokens, type Scenario } from "@/lib/arena/runner";
import { SEED } from "@/lib/seed";
import { displayRecord, failuresForAttempt, type FailureEvidence } from "./scenarios/failure-evidence";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { describeEntry, resultsDir } from "@/app/console/overnight/results";

// What the Safety suite shows, read only from files: the cards in scenarios/ and what real
// runs saved under results/. Nothing here is typed in. A missing file is "no run yet".

export const scenariosDir = () => join(/* turbopackIgnore: true */ process.cwd(), "scenarios");

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((s): s is string => typeof s === "string");

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Plain words for a scenario group id. */
export function groupWords(group: string): string {
  const words = group.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------- the cards: scenarios/*.json ----------

export type Card = {
  id: string;
  file: string;
  group: string;
  source: string;
  /** Only team cards outside the regression set are in the fixed suite. */
  inSuite: boolean;
  direction: "inbound" | "outbound";
  persona: string;
  goal: string;
  seed: string;
  callerLines: string[];
  must: string[];
  mustNot: string[];
  checks: { id: string; mode: string; violation: boolean }[];
  judge: string[];
  needsPharmacist: boolean;
};

export function parseCard(json: unknown, file: string): Card | null {
  const c = obj(json);
  const id = str(c.id);
  if (!id) return null;
  const expected = obj(c.expected);
  return {
    id,
    file,
    group: str(c.group) || "ungrouped",
    source: str(c.source),
    inSuite: c.source === "team" && c.suite !== "regression",
    direction: c.direction === "outbound" ? "outbound" : "inbound",
    persona: str(c.persona),
    goal: str(c.goal),
    seed: str(c.seed),
    callerLines: strs(c.caller_lines),
    must: strs(expected.must),
    mustNot: strs(expected.must_not),
    checks: arr(expected.checks).map(obj).map((k) => ({ id: str(k.id), mode: str(k.mode), violation: k.violation === true })),
    judge: strs(expected.judge),
    needsPharmacist: c.needsPharmacist === true,
  };
}

export async function readCards(dir: string = scenariosDir()): Promise<Card[]> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  const cards = await Promise.all(files.map(async (file) => parseCard(await readJson(join(dir, file)), file)));
  return cards.filter((c): c is Card => c !== null);
}

// ---------- a scenario run: results/arena/scenarios/<run>/scoreboard.json ----------

export type Check = { id: string; passed: boolean; violation: boolean };
export type AttemptScore = { n: number; callId: string; passed: boolean; caught: number; broken: number; checks: Check[]; manualReview: string[] };
export type Outcome = { id: string; group: string; passed: boolean; attempts: AttemptScore[] };
export type ScenarioRun = {
  runId: string;
  dir: string;
  ranAt: string;
  totalScenarios: number;
  completed: boolean;
  passed: number;
  caught: number;
  broken: number;
  outcomes: Outcome[];
  /** How many saved runs there are in all. */
  runs: number;
};

function parseCheck(v: unknown): Check {
  const c = obj(v);
  return { id: str(c.id), passed: c.passed === true, violation: c.violation === true };
}

export function parseScoreboard(json: unknown, meta: { runId: string; dir: string; ranAt: string; runs: number }): ScenarioRun {
  const file = obj(json);
  return {
    ...meta,
    totalScenarios: num(file.totalScenarios),
    completed: file.completed === true,
    passed: num(file.passed),
    caught: num(file.caught),
    broken: num(file.broken),
    outcomes: arr(file.scenarios).map(obj).map((s) => ({
      id: str(s.id),
      group: str(s.group),
      passed: s.passed === true,
      attempts: arr(s.attempts).map(obj).map((a, i) => ({
        n: i + 1,
        callId: str(a.callId),
        passed: a.automatedPassed === true,
        caught: num(a.caught),
        broken: num(a.broken),
        checks: arr(a.checks).map(parseCheck),
        manualReview: strs(a.manualReview),
      })),
    })),
  };
}

export const scenarioRoot = (dir: string = resultsDir()) => join(dir, "arena", "scenarios");

/** The newest saved scenario run (by the scoreboard's modified time), or null. */
export async function readLatestRun(dir: string = resultsDir()): Promise<ScenarioRun | null> {
  const root = scenarioRoot(dir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const path = join(root, e.name, "scoreboard.json");
        return stat(path).then((s) => ({ runId: e.name, path, mtime: s.mtime }), () => null);
      }),
  );
  const runs = found.filter((f): f is NonNullable<typeof f> => f !== null).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const latest = runs[0];
  if (!latest) return null;
  const json = await readJson(latest.path);
  if (json === null) return null;
  return parseScoreboard(json, { runId: latest.runId, dir: join(root, latest.runId), ranAt: latest.mtime.toISOString(), runs: runs.length });
}

// ---------- one attempt's saved call: runs/<id>-<n>.json or attempts/<id>/<n>.json ----------

export type Entry = {
  seq: number;
  kind: string;
  actor: string;
  decision: string;
  button?: string;
  ruleIds: string[];
  text?: string;
  rule?: string;
  replacement?: string;
  why?: string;
  /** For a button: what it was pressed with and what it said back (internal fields left out). */
  input?: Record<string, unknown>;
  result?: unknown;
  hash: string;
  prevHash: string;
};

export type AttemptFile = { n: number; path: string; callId: string; record: Entry[]; score: AttemptScore | null; failures: FailureEvidence[] };

export function parseEntry(v: unknown): Entry {
  const e = obj(v);
  const input = obj(e.input);
  const output = obj(e.output);
  const entry: Entry = {
    seq: num(e.seq),
    kind: str(e.kind),
    actor: str(e.actor),
    decision: str(e.decision),
    ruleIds: strs(e.ruleIds),
    hash: str(e.hash),
    prevHash: str(e.prevHash),
  };
  if (str(e.button)) entry.button = str(e.button);
  if (typeof input.text === "string") entry.text = input.text;
  if (e.kind === "line_blocked") {
    entry.rule = str(output.rule);
    entry.replacement = str(output.replacement);
    entry.why = str(output.why);
    if (entry.rule && !entry.ruleIds.length) entry.ruleIds = [entry.rule];
  }
  if (e.kind === "safety" && typeof output.script === "string") entry.replacement = output.script;
  if (e.kind === "button") {
    entry.input = input;
    if ("result" in output) entry.result = output.result;
  }
  return entry;
}

/** Saved attempt numbers for one scenario in a run, with their file paths. */
async function attemptPaths(runDir: string, id: string): Promise<{ n: number; path: string }[]> {
  const flat = (await readdir(join(runDir, "runs")).catch(() => [] as string[]))
    .map((f) => ({ f, m: f.match(/^(.+)-(\d+)\.json$/) }))
    .filter((x) => x.m?.[1] === id)
    .map((x) => ({ n: Number(x.m![2]), path: join(runDir, "runs", x.f) }));
  const nestedDir = join(runDir, "attempts", encodeURIComponent(id));
  const nested = (await readdir(nestedDir).catch(() => [] as string[]))
    .map((f) => ({ f, m: f.match(/^(\d+)\.json$/) }))
    .filter((x) => x.m)
    .map((x) => ({ n: Number(x.m![1]), path: join(nestedDir, x.f) }));
  const byN = new Map<number, string>();
  for (const a of [...nested, ...flat]) byN.set(a.n, a.path);
  return [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([n, path]) => ({ n, path }));
}

export async function readAttempts(run: ScenarioRun, id: string, cardFile?: string): Promise<AttemptFile[]> {
  const card = cardFile ? await readJson(join(scenariosDir(), cardFile)) as Scenario | null : null;
  let tokens: Record<string, string> = {};
  if (card) {
    // Older/custom definitions may no longer have a matching seed. Unresolved
    // predicates retain their recorded verdict without attributing a turn.
    try { tokens = scenarioTokens(card, scenarioSeed(card, SEED), "{{code}}"); } catch { /* optional historical fixture */ }
  }
  const resolve = (v: string) => v.replace(/\{\{([^}]+)\}\}/g, (token, name) => ["code", "wrong_code"].includes(name) ? token : tokens[name] ?? token);
  const paths = await attemptPaths(run.dir, id);
  const files = await Promise.all(
    paths.map(async ({ n, path }) => {
      const file = obj(await readJson(path));
      if (!Array.isArray(file.record)) return null;
      const score = obj(file.score);
      const savedScore: AttemptScore | null = file.score ? {
        n, callId: str(file.callId), passed: score.automatedPassed === true,
        caught: num(score.caught), broken: num(score.broken), checks: arr(score.checks).map(parseCheck),
        manualReview: strs(score.manualReview),
      } : run.outcomes.find(o => o.id === id)?.attempts.find(a => a.n === n) ?? null;
      const record = displayRecord(file.record.map(parseEntry));
      return {
        n, path, callId: str(file.callId), record, score: savedScore,
        failures: failuresForAttempt(savedScore?.checks ?? [], card?.expected, file.record as RecordEntry[], record, resolve),
      };
    }),
  );
  return files.filter((f): f is AttemptFile => f !== null);
}

// ---------- the list: every card with its latest result ----------

export type Status = "passed" | "failed" | "not_run";
export type Row = { card: Card; status: Status; attempts: AttemptScore[]; caught: number; broken: number };

export function rowsFor(cards: Card[], run: ScenarioRun | null): Row[] {
  const byId = new Map((run?.outcomes ?? []).map((o) => [o.id, o]));
  return cards.map((card) => {
    const o = byId.get(card.id);
    if (!o) return { card, status: "not_run", attempts: [], caught: 0, broken: 0 };
    return {
      card,
      status: o.passed ? "passed" : "failed",
      attempts: o.attempts,
      caught: o.attempts.reduce((n, a) => n + a.caught, 0),
      broken: o.attempts.reduce((n, a) => n + a.broken, 0),
    };
  });
}

// ---------- why each rule is the way it is: results/why/index.json and <id>.json ----------

export type Why = {
  id: string;
  title: string;
  file: string;
  line: number;
  content: string;
  status: string;
  commit: string;
  author: string;
  authorTime: string;
  checkpointId: string;
  sessionId: string;
  agent: string;
  model: string;
};

export type WhyView = { generatedAt: string; records: Why[]; missing: string[] } | null;

export function whyGroup(id: string): "Core rules" | "Speech rules" | "Attack cards" | "The hijack" {
  if (id.startsWith("rule-")) return "Core rules";
  if (/^S\d/.test(id)) return "Speech rules";
  if (id.startsWith("card-")) return "Attack cards";
  return "The hijack";
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function readWhy(dir: string = resultsDir()): Promise<WhyView> {
  const root = join(dir, "why");
  const index = await readJson(join(root, "index.json"));
  if (index === null) return null;
  const file = obj(index);
  const listed = arr(file.records).map(obj).filter((r) => SAFE_ID.test(str(r.id)));
  const records = await Promise.all(
    listed.map(async (r) => {
      const full = obj(await readJson(join(root, `${str(r.id)}.json`)));
      const pick = (k: string) => str(full[k]) || str(r[k]);
      return {
        id: str(r.id),
        title: pick("title"),
        file: pick("file"),
        line: num(full.line) || num(r.line),
        content: str(full.content),
        status: pick("status"),
        commit: pick("commit"),
        author: str(full.author),
        authorTime: str(full.authorTime),
        checkpointId: pick("checkpointId"),
        sessionId: pick("sessionId"),
        agent: str(full.agent),
        model: str(full.model),
      };
    }),
  );
  return { generatedAt: str(file.generatedAt), records, missing: strs(file.missing) };
}

export const RUN_COMMANDS = {
  suite: "Run suite above (POST /api/arena/run), or LIVE_SUITE=1 LIVE_AGENT=1 npx vitest run lib/arena/live-suite.run.test.ts",
  why: "node scripts/why.ts",
} as const;

export const when = (iso: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "time not recorded");

/** A run that wrote its scoreboard in the last ten minutes and hasn't finished is still going. */
export function stillRunning(run: ScenarioRun | null, now: number = Date.now()): boolean {
  return run !== null && !run.completed && now - new Date(run.ranAt).getTime() < 10 * 60_000;
}

/** A saved file's path as people know it: results/…, wherever RESULTS_DIR points. */
export function shortPath(path: string, dir: string = resultsDir()): string {
  const inResults = relative(dir, path);
  if (!inResults.startsWith("..") && !isAbsolute(inResults)) return join("results", inResults);
  const inRepo = relative(process.cwd(), path);
  return inRepo.startsWith("..") ? path : inRepo;
}

// ---------- the hijack batch: results/hijack/<batch>/<card>.json (picks are pick-<time>, not batches) ----------

export type BatchCardRun = { cardId: string; callId: string; passed: boolean; failedChecks: string[]; caught: number; broken: number; path: string; steps: string[] };
export type BatchView = { path: string; ranAt: string; batches: number; cards: number; caught: number; broken: number; runs: BatchCardRun[] };

/** The newest full hijack batch (a judge's single pick on the stage isn't a batch), or null. */
export async function readLatestBatch(dir: string = resultsDir()): Promise<BatchView | null> {
  const root = join(dir, "hijack");
  const entries = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith("pick-"));
  const batches = (
    await Promise.all(
      entries.map(async (e) => {
        const path = join(root, e.name);
        const files = (await readdir(path).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => join(path, f));
        const times = await Promise.all(files.map((f) => stat(f).then((s) => s.mtimeMs, () => 0)));
        return { path, files, mtime: batchTime(e.name, Math.max(0, ...times)) };
      }),
    )
  )
    .filter((b) => b.files.length > 0)
    .sort((a, b) => b.mtime - a.mtime);
  const latest = batches[0];
  if (!latest) return null;
  const runs = (
    await Promise.all(
      latest.files.map(async (path): Promise<BatchCardRun | null> => {
        const run = obj(await readJson(path));
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
    )
  ).filter((r): r is BatchCardRun => r !== null);
  return {
    path: latest.path,
    ranAt: new Date(latest.mtime).toISOString(),
    batches: batches.length,
    cards: runs.length,
    caught: runs.reduce((n, r) => n + r.caught, 0),
    broken: runs.reduce((n, r) => n + r.broken, 0),
    runs,
  };
}

/**
 * When a saved run happened: the time in its folder name (2026-11-22T00-08-58-709Z, as the
 * runners name them), else its files' modified time. A fresh checkout gives every file the
 * same modified time, so the name is the only reliable order.
 */
export function batchTime(name: string, mtimeMs: number): number {
  const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z/);
  if (!m) return mtimeMs;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] ?? "000"}Z`);
  return Number.isFinite(t) ? t : mtimeMs;
}
