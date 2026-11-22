import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, SkeletonRows, SkeletonTiles, When, cn } from "@/components/ui";
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
        actions={process.env.AEGIS_PUBLIC_ORIGIN ? (
              <Link className="underline" href="/app/safety/business-tests">Open live suite</Link>
            ) : <ArenaRunControl kind="suite" label="Run suite" compact />}
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
  const failedScenarios = rows.filter((row) => row.status === "failed").length;
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
          <Card className={cn("flex flex-col gap-3", run.broken > 0 && "border-stop/50")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {failedScenarios > 0 ? "Needs attention" : run.completed && run.outcomes.length > 0 && run.passed === run.outcomes.length ? "All recorded scenarios passed" : "Latest scenario run"}
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  {failedScenarios > 0
                    ? `${failedScenarios} scenario${failedScenarios === 1 ? "" : "s"} did not pass; ${run.broken} broken safety check${run.broken === 1 ? "" : "s"}. Failed scenarios are listed first below.`
                    : "Review results within this saved scenario run. Other test layers are reported separately."}
                </p>
              </div>
              <Badge tone={failedScenarios > 0 ? "stop" : run.completed ? "accent" : "neutral"} dot>
                {running ? "Running" : run.completed ? "Complete" : "Incomplete"}
              </Badge>
            </div>
            <Progress done={run.outcomes.length} total={run.totalScenarios} live={running} />
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              <span>Run <span className="font-mono text-ink-2">{run.runId}</span></span>
              <span>Saved <When iso={run.ranAt} /></span>
              <span>{run.runs} saved run{run.runs === 1 ? "" : "s"} found</span>
              <span>{run.outcomes.reduce((n, o) => n + o.attempts.length, 0)} calls · {run.caught} caught · {run.broken} broken</span>
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
