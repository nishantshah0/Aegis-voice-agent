// Task 4.10: the `entire why` export. For each of the demo's key decisions (every rule card,
// core rules 1 and 5, speech rules S1 to S4, the hijack driver and its call ids) it finds the
// line in the current source, asks `entire why <file>:<line> --json`, and saves a compact
// record to results/why/<id>.json plus results/why/index.json. The console's Rules tab reads
// these. Rerun before the demo: node scripts/why.ts
//
// Every field comes from Entire. A line with only a commit has no session or prompt, and
// none is invented. Prompts are scrubbed of emails and phone-like numbers and capped.

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export type WhyTarget = { id: string; title: string; file: string; needle: string };

export type WhyRecord = {
  id: string;
  title: string;
  file: string;
  line: number;
  content: string;
  /** "checkpoint" when an AI session wrote it, "commit" when only git knows. */
  status: string;
  commit: string | null;
  author: string | null;
  authorTime: string | null;
  checkpointId: string | null;
  sessionId: string | null;
  agent: string | null;
  model: string | null;
  prompt: string | null;
};

export const CARDS_FILE = "lib/contract/cards.ts";

export const WHY_TARGETS: readonly WhyTarget[] = [
  { id: "rule-1", title: "Core rule 1: only the verified patient's own prescriptions", file: "lib/control/press.ts", needle: 'blocked("not_yours", ["1"]' },
  { id: "rule-5", title: "Core rule 5: a new address needs a pharmacist", file: "lib/control/press.ts", needle: 'ruleIds: ["5"]' },
  { id: "S1", title: "Speech rule S1: nothing private before verification", file: "lib/guard/speech.ts", needle: 'rule: "S1", why: found' },
  { id: "S2", title: "Speech rule S2: nothing about another patient", file: "lib/guard/speech.ts", needle: 'rule: "S2", why: found' },
  { id: "S3", title: "Speech rule S3: no dose that isn't on the label", file: "lib/guard/speech.ts", needle: 'rule: "S3", why: missing' },
  { id: "S4", title: "Speech rule S4: no promise the record doesn't back", file: "lib/guard/speech.ts", needle: 'rule: "S4", why: "completion without approval"' },
  { id: "hijack-driver", title: "The hijack switch: a fully fooled AI through the same lock", file: "lib/agent/hijack.ts", needle: "export function createHijackDriver" },
  { id: "hijack-call-ids", title: "Hijack batch events use their own call ids (Trail #14)", file: "lib/arena/hijack-batch.ts", needle: "function cardEmit" },
  { id: "stage-pick", title: "A judge's pick on the stage runs through the real lock", file: "app/stage/attack-run.ts", needle: "function stageEmit" },
];

/** The first line holding the needle, counted from 1, or null. */
export function locate(source: string, needle: string): number | null {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  return index === -1 ? null : index + 1;
}

/** One target per rule card in the cards file. */
export function cardTargets(cardsSource: string): WhyTarget[] {
  return [...cardsSource.matchAll(/^\s*id: "([\w-]+)",/gm)].map((m) => ({
    id: `card-${m[1]}`,
    title: `Rule card ${m[1]}`,
    file: CARDS_FILE,
    needle: `id: "${m[1]}",`,
  }));
}

const MAX_PROMPT = 600;

export function scrub(text: string): string {
  const clean = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\(\d{3}\)\s?\d{3}[\s.-]?\d{4}/g, "[number]")
    .replace(/\b\d{3}-\d{4}\b/g, "[number]");
  return clean.length > MAX_PROMPT ? `${clean.slice(0, MAX_PROMPT)}…` : clean;
}

type WhyLine = {
  line_number?: number;
  status?: string;
  short_commit_sha?: string;
  author?: string;
  author_time?: string;
  checkpoint_id?: string;
  session_id?: string;
  agent?: string;
  model?: string;
  prompt?: string;
  content?: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function compactWhy(target: WhyTarget, why: unknown): WhyRecord {
  const line: WhyLine = (why as { line?: WhyLine })?.line ?? {};
  const prompt = str(line.prompt);
  return {
    id: target.id,
    title: target.title,
    file: target.file,
    line: typeof line.line_number === "number" ? line.line_number : 0,
    content: (line.content ?? "").trim(),
    status: str(line.status) ?? "unknown",
    commit: str(line.short_commit_sha),
    author: str(line.author),
    authorTime: str(line.author_time),
    checkpointId: str(line.checkpoint_id),
    sessionId: str(line.session_id),
    agent: str(line.agent),
    model: str(line.model),
    prompt: prompt ? scrub(prompt) : null,
  };
}

export type WhyDeps = {
  read: (file: string) => string;
  why: (file: string, line: number) => Promise<unknown>;
};

export async function exportWhy(targets: readonly WhyTarget[], deps: WhyDeps): Promise<{ records: WhyRecord[]; missing: string[] }> {
  const records: WhyRecord[] = [];
  const missing: string[] = [];
  for (const target of targets) {
    let line: number | null = null;
    try {
      line = locate(deps.read(target.file), target.needle);
    } catch {
      line = null;
    }
    if (line === null) {
      missing.push(target.id);
      continue;
    }
    records.push(compactWhy(target, await deps.why(target.file, line)));
  }
  return { records, missing };
}

async function main() {
  const outDir = process.argv[2] ?? "results/why";
  const run = promisify(execFile);
  const read = (file: string) => readFileSync(file, "utf8");
  const targets = [...WHY_TARGETS, ...cardTargets(read(CARDS_FILE))];
  const { records, missing } = await exportWhy(targets, {
    read,
    why: async (file, line) => JSON.parse((await run("entire", ["why", `${file}:${line}`, "--json"], { maxBuffer: 16 * 1024 * 1024 })).stdout),
  });
  mkdirSync(outDir, { recursive: true });
  for (const record of records) writeFileSync(join(outDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const index = {
    generatedAt: new Date().toISOString(),
    source: "entire why <file>:<line> --json",
    missing,
    records: records.map(({ id, title, file, line, status, commit, checkpointId, sessionId }) => ({ id, title, file, line, status, commit, checkpointId, sessionId })),
  };
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  const fromSessions = records.filter((r) => r.status === "checkpoint").length;
  console.log(`${outDir}: ${records.length} decisions (${fromSessions} from an AI session, ${records.length - fromSessions} commit only), ${missing.length} not found${missing.length ? `: ${missing.join(", ")}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
