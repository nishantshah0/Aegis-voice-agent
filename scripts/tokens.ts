// Task 4.9: token measurement. Sums results/agent-usage.jsonl (one line per agent turn,
// written by lib/agent/usage.ts) into a short per-model table at results/tokens-latest.json.
// Cost is the Agent SDK's own costUsd per turn, summed. No price table, so no guessed numbers:
// if any turn has no cost, that model's cost is null.
//
// Run: node scripts/tokens.ts [log] [out]

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type TokenRow = {
  /** Distinct calls (callId). */
  calls: number;
  /** Logged agent turns. */
  turns: number;
  /** Model requests the turns made. */
  modelCalls: number;
  errors: number;
  /** Uncached + cache write + cache read. */
  inputTokens: number;
  uncachedInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number | null;
};

export type TokenSummary = {
  source: string;
  generatedAt: string;
  firstTurnAt: string | null;
  lastTurnAt: string | null;
  skippedLines: number;
  notes: string[];
  models: Record<string, TokenRow>;
  total: TokenRow;
};

type Line = {
  at?: string;
  callId?: string;
  model?: string;
  modelCalls?: number;
  costUsd?: number;
  subtype?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
  };
};

const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const round = (n: number): number => Math.round(n * 1e8) / 1e8;

function emptyRow(): TokenRow {
  return {
    calls: 0,
    turns: 0,
    modelCalls: 0,
    errors: 0,
    inputTokens: 0,
    uncachedInputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
  };
}

function parse(raw: string): Line | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const line = value as Line;
    return typeof line.model === "string" && typeof line.callId === "string" ? line : null;
  } catch {
    return null;
  }
}

function add(row: TokenRow, line: Line, callIds: Set<string>) {
  const u = line.usage ?? {};
  const uncached = num(u.input_tokens);
  const write = num(u.cache_creation_input_tokens);
  const read = num(u.cache_read_input_tokens);
  callIds.add(line.callId as string);
  row.calls = callIds.size;
  row.turns += 1;
  row.modelCalls += Math.max(1, num(line.modelCalls));
  if (line.subtype && line.subtype !== "success") row.errors += 1;
  row.uncachedInputTokens += uncached;
  row.cacheWriteTokens += write;
  row.cacheReadTokens += read;
  row.inputTokens += uncached + write + read;
  row.outputTokens += num(u.output_tokens);
  row.thinkingTokens += num(u.output_tokens_details?.thinking_tokens);
  row.costUsd = row.costUsd === null || typeof line.costUsd !== "number" ? null : round(row.costUsd + line.costUsd);
}

export function summarizeUsage(lines: string[], source = "results/agent-usage.jsonl"): TokenSummary {
  const models: Record<string, TokenRow> = {};
  const modelCallIds = new Map<string, Set<string>>();
  const total = emptyRow();
  const allCallIds = new Set<string>();
  let skippedLines = 0;
  const times: string[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const line = parse(raw);
    if (!line) {
      skippedLines += 1;
      continue;
    }
    const model = line.model as string;
    models[model] ??= emptyRow();
    if (!modelCallIds.has(model)) modelCallIds.set(model, new Set());
    add(models[model], line, modelCallIds.get(model) as Set<string>);
    add(total, line, allCallIds);
    if (line.at) times.push(line.at);
  }

  if (total.turns === 0) total.costUsd = null;
  times.sort();
  return {
    source,
    generatedAt: new Date().toISOString(),
    firstTurnAt: times[0] ?? null,
    lastTurnAt: times.at(-1) ?? null,
    skippedLines,
    notes: [
      "calls counts distinct call ids. A demo reset starts call ids again at c_0001, so calls across resets share an id; turns is the better count.",
      "costUsd is the Agent SDK's own reported cost per turn, summed. It is null if any turn has none.",
    ],
    models,
    total,
  };
}

function main() {
  const [log = "results/agent-usage.jsonl", out = "results/tokens-latest.json"] = process.argv.slice(2);
  const summary = summarizeUsage(readFileSync(log, "utf8").split("\n"), log);
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  const t = summary.total;
  console.log(
    `${out}: ${t.calls} calls, ${t.turns} turns, ${t.modelCalls} model calls, ${t.inputTokens} input and ${t.outputTokens} output tokens, cost ${t.costUsd === null ? "unknown" : `$${t.costUsd.toFixed(4)}`}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
