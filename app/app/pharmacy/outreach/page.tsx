import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { loadOutreach } from "./data";
import { OutreachView } from "./OutreachView";
import { RunControls } from "./RunControls";

export const metadata = { title: "Outreach · Pharmacy · Aegis" };

async function Outreach({ searchParams }: { searchParams: Promise<{ run?: string | string[] }> }) {
  await connection();
  const { run } = await searchParams;
  const load = await loadOutreach(typeof run === "string" ? run : undefined);
  const current = load.state === "ok" ? load.data.summary.runId : load.state === "missing" ? load.runId : undefined;
  const runs = load.state === "ok" ? load.data.runs : load.runs;
  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Outreach
            <Badge tone="quick" dot className="align-middle">
              Simulated population
            </Badge>
          </span>
        }
        description="Who the line would call over the next 30 days, why, and where each refill would land. Made-up patients; predicted outcomes."
        actions={<RunControls runs={runs} current={current} />}
      />
      {load.state === "none" && (
        <Card className="mt-6 text-sm text-ink-2">
          No simulation run saved yet. Make one with <code className="font-mono text-xs text-ink">{load.command}</code>, or press Run simulation.
        </Card>
      )}
      {load.state === "missing" && (
        <Card className="mt-6 text-sm text-ink-2">
          Can&apos;t read simulation run <code className="font-mono text-xs text-ink">results/sim/{load.runId}/</code>. Pick another saved run.
        </Card>
      )}
      {load.state === "ok" && <OutreachView key={load.data.summary.runId} data={load.data} />}
    </>
  );
}

export default function OutreachPage({ searchParams }: PageProps<"/app/pharmacy/outreach">) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">Reading the saved simulation…</p>}>
      <Outreach searchParams={searchParams} />
    </Suspense>
  );
}
