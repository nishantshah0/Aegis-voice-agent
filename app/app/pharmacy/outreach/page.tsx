import { PHARMACY_NAV } from "../../_shell/nav";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { SIGN_IN_TO_APP } from "../../_shell/RequireSignIn";
import { Badge, Card, PageHeader, Skeleton, SkeletonRows, SkeletonTiles } from "@/components/ui";
import { loadOutreachSignedIn } from "./data";
import { OutreachView } from "./OutreachView";
import { RunControls } from "./RunControls";

export const metadata = { title: `${PHARMACY_NAV.forecast.label} · Pharmacy · Aegis` };

async function Outreach({ searchParams }: { searchParams: Promise<{ run?: string | string[] }> }) {
  await connection();
  const { run } = await searchParams;
  // Sign-in is checked here, before any saved run is read (the /app proxy and layout check too).
  const load = await loadOutreachSignedIn(typeof run === "string" ? run : undefined);
  if (load.state === "signed_out") redirect(SIGN_IN_TO_APP);
  const current = load.state === "ok" ? load.data.summary.runId : load.state === "missing" ? load.runId : undefined;
  const runs = load.state === "ok" ? load.data.runs : load.runs;
  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {PHARMACY_NAV.forecast.label}
            <Badge tone="neutral" dot className="align-middle">
              Saved simulation
            </Badge>
          </span>
        }
        description="Synthetic patients · Predicted outcomes"
        actions={<RunControls runs={runs} current={current} />}
      />
      {load.state === "none" && (
        <Card className="mt-8 text-sm text-ink-2">
          No saved simulation yet. Use Run simulation above to create the first forecast.
        </Card>
      )}
      {load.state === "missing" && (
        <Card className="mt-8 text-sm text-ink-2">
          Can&apos;t load saved run <code className="font-mono text-xs text-ink">results/sim/{load.runId}/</code>. {runs.length > 0 ? "Select another saved run or run a new simulation above." : "No other saved runs are available. Run a new simulation above."}
        </Card>
      )}
      {load.state === "ok" && <OutreachView key={load.data.summary.runId} data={load.data} />}
    </>
  );
}

export default function OutreachPage({ searchParams }: PageProps<"/app/pharmacy/outreach">) {
  return (
    <Suspense
      fallback={
        <div aria-busy aria-label="Loading">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-96" />
          <SkeletonTiles className="mt-8" />
          <Skeleton className="mt-6 h-64 rounded-card" />
          <SkeletonRows className="mt-6" />
        </div>
      }
    >
      <Outreach searchParams={searchParams} />
    </Suspense>
  );
}
