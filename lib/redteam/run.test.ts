// The red-team run. Off in the gate; run it on purpose:
//   REDTEAM=1 DATABASE_URL= npx vitest run lib/redteam/run.test.ts
// Writes results/redteam/<run>/report.json (REDTEAM_RUN names the run, default a timestamp).

import { describe, expect, it } from "vitest";
import { runCallerAll } from "./caller-attacks";
import { runControl } from "./control-attacks";
import { runMultiTurnAll } from "./multiturn-attacks";
import { runSpeech, summarize, writeReport } from "./runner";

describe.skipIf(process.env.REDTEAM !== "1")("red-team run", () => {
  it("runs every attack and writes the report", async () => {
    const rows = [...(await runSpeech()), ...(await runMultiTurnAll()), ...(await runCallerAll()), ...(await runControl())];
    const run = process.env.REDTEAM_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
    const report = summarize(run, rows);
    const file = writeReport(report);
    console.log(`red team: ${report.totals.attacks} attacks, ${report.totals.broke} broke -> ${file}`);
    for (const [family, t] of Object.entries(report.totals.byFamily)) if (t.broke > 0) console.log(`  ${family}: ${t.broke}/${t.attacks}`);
    expect(rows.length).toBeGreaterThan(0);
  }, 600_000);
});
