// The Agent SDK runs on Nishant's own Claude plan, so it is capped (HUMAN, 12:02):
// a hard limit of model calls per hour per process (AGENT_CALLS_PER_HOUR, default 60), then a clear error, and one
// JSON line per turn in results/agent-usage.jsonl with that turn's tokens.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_CALLS_PER_HOUR = 60;

/** AGENT_CALLS_PER_HOUR, if it is a whole number above zero; otherwise 60. */
export function callsPerHour(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  return /^[1-9]\d*$/.test(text) ? Number(text) : DEFAULT_CALLS_PER_HOUR;
}

/** The hourly cap: 60, or AGENT_CALLS_PER_HOUR when it is set. */
export const CALLS_PER_HOUR = callsPerHour(process.env.AGENT_CALLS_PER_HOUR);
export const USAGE_LOG = "results/agent-usage.jsonl";
const HOUR_MS = 60 * 60 * 1000;

export class UsageCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageCapError";
  }
}

export type UsageEntry = {
  callId: string;
  model: string;
  /** Model calls this turn made (the SDK's turns). Counts as at least one. */
  modelCalls: number;
  usage?: unknown;
  costUsd?: number;
  subtype?: string;
};

export type UsageCap = {
  /** Throws UsageCapError if one more model call would pass the hourly cap. */
  check(): void;
  record(entry: UsageEntry): void;
  /** Model calls in the last hour. */
  used(): number;
};

function appendLine(path: string, line: string) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}

export function createUsageCap({
  perHour = CALLS_PER_HOUR,
  now = Date.now,
  logPath = USAGE_LOG,
  append = appendLine,
}: { perHour?: number; now?: () => number; logPath?: string; append?: (path: string, line: string) => void } = {}): UsageCap {
  const calls: { at: number; n: number }[] = [];
  const used = () => {
    const since = now() - HOUR_MS;
    while (calls.length && calls[0].at <= since) calls.shift();
    return calls.reduce((sum, c) => sum + c.n, 0);
  };
  return {
    check() {
      if (used() + 1 > perHour) {
        throw new UsageCapError(`The Agent SDK usage cap is reached: ${perHour} model calls an hour. Try again later.`);
      }
    },
    record(entry) {
      calls.push({ at: now(), n: Math.max(1, entry.modelCalls) });
      append(logPath, `${JSON.stringify({ at: new Date(now()).toISOString(), ...entry })}\n`);
    },
    used,
  };
}

/** One cap for the whole server process. */
let processCap: UsageCap | undefined;
export const sharedUsageCap = (): UsageCap => (processCap ??= createUsageCap());
