import { readFile } from "node:fs/promises";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, PageHeader, Skeleton, SkeletonRows } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { USAGE_LOG } from "@/lib/agent/usage";
import { getDriver, getStore } from "@/app/api/_lib/runtime";
import type { TimingSource } from "@/app/console/calls/calls";
import { usageFor } from "./[id]/detail";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { HistoryTable } from "./HistoryTable";
import { history } from "./history";
import { parseHistoryFilter } from "./rows";

export const metadata = { title: "Calls · Pharmacy · Aegis" };

async function Body({ searchParams }: { searchParams: PageProps<"/app/pharmacy/calls">["searchParams"] }) {
  await connection(); // Live data: never prerender.
  if (!(await getApprover())) return <SignedOut what="the voice agent's calls" />;
  const initialFilter = parseHistoryFilter(await searchParams);
  const driver = getDriver();
  const timings = "turnTimings" in driver ? (driver as TimingSource) : undefined;
  const { rows, chain, callerTurns = {}, scripted = [] } = await history(getStore(), { driver: timings });
  return (
    <>
      <p className="mt-6 flex flex-wrap items-center gap-2 text-sm" data-testid="chain">
        {chain.verified ? (
          <Badge tone="accent" dot>Record chain verified</Badge>
        ) : (
          <><Badge tone="stop" dot>Record chain broken at entry {chain.brokenAt}</Badge><Link href="/app/safety" className="text-accent underline-offset-4 hover:underline">Inspect integrity</Link></>
        )}{" "}
      </p>
      <div className="mt-6">
        <HistoryTable rows={rows} scripted={scripted} initialFilter={initialFilter} />
      </div>
      <Suspense fallback={<p className="mt-6 text-xs text-ink-3">Usage and cost details are loading.</p>}>
        <UsageDetails rows={rows} callerTurns={callerTurns} />
      </Suspense>
    </>
  );
}

async function UsageDetails({ rows, callerTurns }: { rows: Awaited<ReturnType<typeof history>>["rows"]; callerTurns: Record<string, number> }) {
  const log = await readFile(USAGE_LOG, "utf8").catch(() => "");
  // Only the usage of the calls listed here, matched the way each call's page matches it: the call
  // id's newest log rows, one per caller turn (ids restart at c_0001 after a reset). AUDIT #13.
  const usage = rows.flatMap((row) => usageFor(log, row.callId).slice(0, callerTurns[row.callId] ?? 0));
  const modelCalls = usage.reduce((s, u) => s + u.modelCalls, 0);
  const cost = usage.reduce((s, u) => s + u.costUsd, 0);
  return <details className="mt-6 rounded-card border border-line bg-surface px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">Usage and cost</summary><p className="mt-2 text-ink-2">Model calls: {modelCalls.toLocaleString("en-US")} · Cost: ${cost.toFixed(4)}</p><p className="mt-1 text-xs text-ink-3">Usage is matched to the caller turns in these call records.</p></details>;
}

export default function HistoryPage({ searchParams }: PageProps<"/app/pharmacy/calls">) {
  return (
    <>
      <PageHeader title="Calls" description="Search the call record, see how each call ended, and follow its routing evidence." actions={<Live />} />
      <Suspense
        fallback={
          <div className="mt-8">
            <Skeleton className="mt-6 h-8 w-64" />
            <SkeletonRows className="mt-4" />
          </div>
        }
      >
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
