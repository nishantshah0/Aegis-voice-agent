import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageHeader, SkeletonRows, SkeletonTiles, StatTile, When } from "@/components/ui";
import { groupWords, readCards, readLatestRun, rowsFor, RUN_COMMANDS, shortPath, stillRunning } from "../data";
import { Progress } from "../Progress";
import { ArenaRunControl } from "../ArenaRunControl";
import { AutoRefresh } from "../RunButton";
import { ScenarioTable, type TableRow } from "./ScenarioTable";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Scenarios · Safety suite · Aegis" };

export default function ScenariosPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Scenarios"
        description="Scripted callers, each run three times through the real driver, buttons and speech guard, and scored only from the record."
        actions={<ArenaRunControl kind="suite" label="Run suite" compact />}
      />
      <Suspense
        fallback={
          <div className="mt-8 flex flex-col gap-6">
            <SkeletonTiles />
            <SkeletonRows rows={8} />
          </div>
        }
      >
        <Scenarios />
      </Suspense>
    </SuiteGate>
  );
}

async function Scenarios() {
  await connection(); // A running suite rewrites its scoreboard: never prerender.
  const [cards, run] = await Promise.all([readCards(), readLatestRun()]);
  const rows = rowsFor(cards, run);
  const running = stillRunning(run);
  const groups = [...new Set(cards.map((c) => c.group))].sort().map((g) => ({ key: g, label: groupWords(g) }));

  const table: TableRow[] = rows.map((r) => ({
    id: r.card.id,
    persona: r.card.persona,
    goal: r.card.goal,
    group: r.card.group,
    groupLabel: groupWords(r.card.group),
    inSuite: r.card.inSuite,
    status: r.status,
    caught: r.caught,
    broken: r.broken,
    attempts: r.attempts.map((a) => ({ n: a.n, passed: a.passed, failed: a.checks.filter((c) => !c.passed).map((c) => c.id), caught: a.caught, broken: a.broken })),
  }));

  return (
    <div className="mt-8 flex flex-col gap-6">
      <AutoRefresh active={running} />
      {run ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile label="Passing 3 of 3" value={`${run.passed} / ${run.outcomes.length}`} tone="accent" hint={`${run.totalScenarios} cards in the suite`} />
            <StatTile label="Calls" value={run.outcomes.reduce((n, o) => n + o.attempts.length, 0)} />
            <StatTile label="Caught" value={run.caught} tone="review" hint="Blocked presses and lines" />
            <StatTile label="Broken" value={run.broken} tone={run.broken === 0 ? "accent" : "stop"} hint="Failed safety checks" />
          </div>
          <Card className="flex flex-col gap-2">
            <Progress done={run.outcomes.length} total={run.totalScenarios} live={running} />
            <p className="text-xs text-ink-3">
              Run <span className="font-mono">{run.runId.slice(0, 8)}</span> · scoreboard written <When iso={run.ranAt} /> · {run.runs} saved run{run.runs === 1 ? "" : "s"} ·{" "}
              <code className="font-mono" title={run.dir}>
                {shortPath(run.dir)}
              </code>
            </p>
          </Card>
        </>
      ) : (
        <Card className="text-sm text-ink-2">
          <p className="font-medium text-ink">No scenario run saved yet</p>
          <p className="mt-1">
            Run the suite with <code className="font-mono text-xs">{RUN_COMMANDS.suite}</code>. It saves to{" "}
            <code className="font-mono text-xs">results/arena/scenarios/&lt;run&gt;/</code>, and every card below picks up its result.
          </p>
        </Card>
      )}
      <ScenarioTable rows={table} groups={groups} />
    </div>
  );
}
