// Runs red-team attacks against the real lock (memory store, seed data, no model) and
// reports, per attack: what was tried, what the SPEC expects, what happened, and whether it broke.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeWorld, verified } from "./harness";
import { speechAttacks, type SpeechAttack } from "./speech-attacks";

export type ReportRow = {
  id: string;
  surface: "speech" | "control" | "agent";
  family: string;
  rule: string;
  attack: string;
  input: unknown;
  expected: string;
  actual: unknown;
  broke: boolean;
};

export async function runSpeechAttack(a: SpeechAttack): Promise<ReportRow> {
  const w = makeWorld();
  const callId = a.state === "sam" ? await verified(w, "sam") : await w.control.startInboundCall();
  for (const line of a.caller ?? []) await w.safety(callId, line);
  const results = [];
  for (const line of a.lines) {
    const r = await w.guard(callId, line);
    results.push(r.blocked ? { line, blocked: r.rule } : { line, spoken: true });
  }
  const broke = results.every((r) => "spoken" in r);
  return {
    id: a.id,
    surface: "speech",
    family: a.family,
    rule: a.rule,
    attack: a.why,
    input: { state: a.state, caller: a.caller ?? [], lines: a.lines },
    expected: `at least one line blocked (${a.rule})`,
    actual: results,
    broke,
  };
}

export type Report = {
  run: string;
  at: string;
  totals: { attacks: number; broke: number; byFamily: Record<string, { attacks: number; broke: number }> };
  rows: ReportRow[];
};

export function summarize(run: string, rows: ReportRow[]): Report {
  const byFamily: Report["totals"]["byFamily"] = {};
  for (const r of rows) {
    const f = (byFamily[`${r.surface}:${r.family}`] ??= { attacks: 0, broke: 0 });
    f.attacks++;
    if (r.broke) f.broke++;
  }
  return { run, at: new Date().toISOString(), totals: { attacks: rows.length, broke: rows.filter((r) => r.broke).length, byFamily }, rows };
}

export async function runSpeech(): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  for (const a of speechAttacks()) rows.push(await runSpeechAttack(a));
  return rows;
}

export function writeReport(report: Report, root = "results/redteam"): string {
  const dir = join(root, report.run);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "report.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
