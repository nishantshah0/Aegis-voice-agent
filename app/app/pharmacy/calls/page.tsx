import { readFile } from "node:fs/promises";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, PageHeader, Skeleton, SkeletonRows, SkeletonTiles, StatTile } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { USAGE_LOG } from "@/lib/agent/usage";
import { getDriver, getStore } from "@/app/api/_lib/runtime";
import { parseUsage, type TimingSource } from "@/app/console/calls/calls";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { HistoryTable } from "./HistoryTable";
import { history } from "./history";

export const metadata = { title: "Calls · Pharmacy · Aegis" };

async function Body() {
  await connection(); // Live data: never prerender.
  if (!(await getApprover())) return <SignedOut what="the voice agent's calls" />;
  const driver = getDriver();
  const timings = "turnTimings" in driver ? (driver as TimingSource) : undefined;
  const [{ rows, chain }, log] = await Promise.all([history(getStore(), { driver: timings }), readFile(USAGE_LOG, "utf8").catch(() => "")]);
  const usage = Object.values(parseUsage(log).byModel);
  const cost = usage.reduce((s, m) => s + m.costUsd, 0);
  const blocked = rows.reduce((s, r) => s + r.blocked, 0);
  const waiting = rows.filter((r) => r.outcome === "waiting").length;
  return (
    <>
      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Calls" value={rows.length} />
        <StatTile label="Waiting for a pharmacist" value={waiting} tone={waiting ? "review" : "neutral"} />
        <StatTile label="Lines blocked" value={blocked} tone={blocked ? "stop" : "neutral"} />
        <StatTile label="Model calls (log)" value={usage.reduce((s, m) => s + m.modelCalls, 0)} />
        <StatTile label="Cost (log)" value={`$${cost.toFixed(4)}`} />
      </section>
      <p className="mt-3 text-sm" data-testid="chain">
        {chain.verified ? (
          <Badge tone="accent" dot>
            Record chain verified
          </Badge>
        ) : (
          <Badge tone="stop" dot>
            Record chain broken at entry {chain.brokenAt}
          </Badge>
        )}{" "}
        <span className="text-ink-3">
          {chain.entries} entries{chain.headHash && <span className="font-mono"> · head {chain.headHash.slice(0, 12)}…</span>}
        </span>
      </p>
      <div className="mt-6">
        <HistoryTable rows={rows} />
      </div>
    </>
  );
}

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="Calls" description="Every call, from the record: what was said, every button pressed, every blocked line." actions={<Live />} />
      <Suspense
        fallback={
          <div className="mt-8">
            <SkeletonTiles className="md:grid-cols-5" count={5} />
            <Skeleton className="mt-6 h-8 w-96" />
            <SkeletonRows className="mt-4" />
          </div>
        }
      >
        <Body />
      </Suspense>
    </>
  );
}
