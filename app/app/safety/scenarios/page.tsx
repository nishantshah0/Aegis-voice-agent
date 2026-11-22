import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { ScenarioList } from "./ScenarioList";
import { scenarioRows } from "./data";

export const metadata = { title: "Scenarios · Safety suite · Aegis" };

async function Scenarios() {
  await connection();
  const { rows, run } = await scenarioRows();
  const passed = rows.filter((r) => r.status === "passed").length;
  return (
    <>
      {run ? (
        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Passed" value={`${passed} / ${rows.length}`} tone="accent" />
          <StatTile label="Caught" value={run.report.caught} />
          <StatTile label="Rules broken" value={run.report.broken} tone={run.report.broken === 0 ? "accent" : "stop"} />
          <StatTile label="Last run" value={<span className="text-xl">{new Date(run.ranAt).toLocaleString()}</span>} hint={run.report.completed ? "Completed" : "Still running"} />
        </section>
      ) : (
        <Card className="mt-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <p className="font-semibold text-ink">No suite run saved yet</p>
              <p className="mt-1 text-sm text-ink-2">
                Each card runs three times through the real lock and is scored from the record. A run writes{" "}
                <span className="font-mono text-xs">results/arena/scenarios/&lt;run&gt;/scoreboard.json</span>, and its results show up here.
              </p>
            </div>
            <span title="Needs the scenario run route (POST /api/arena/run, Role 3)">
              <button type="button" disabled className="h-9 rounded-full border border-line-strong px-4 text-sm text-ink-3">
                Run the suite
              </button>
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            <Badge tone="neutral">Coming</Badge> <span className="ml-1">Running from here needs Role 3&apos;s run route; until then: runFixedScenarioSuite() in lib/arena/suite-files.ts.</span>
          </p>
        </Card>
      )}
      <ScenarioList rows={rows} />
    </>
  );
}

export default function ScenariosPage() {
  return (
    <>
      <PageHeader title="Scenarios" description="The scripted test calls: ordinary patients, people trying to get past identity, leaks, rule-bending and emergencies." />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading the scenario cards…</p>}>
        <Scenarios />
      </Suspense>
    </>
  );
}
