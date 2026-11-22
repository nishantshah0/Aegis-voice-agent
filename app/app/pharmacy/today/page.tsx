import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { DemoControls } from "@/app/console/today/DemoControls";
import { EventFeed } from "@/app/console/today/EventFeed";
import { LaneTotals } from "@/app/console/today/LaneTotals";
import { laneTotals } from "@/app/console/today/detail";
import { PairPhone } from "@/app/console/today/PairPhone";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { TodayBoard } from "./TodayBoard";
import { today } from "./today";

export const metadata = { title: "Today · Pharmacy · Aegis" };

async function Board({ searchParams }: { searchParams: PageProps<"/app/pharmacy/today">["searchParams"] }) {
  await connection(); // Live data: never prerender.
  const store = getStore();
  const approver = await getApprover();
  if (!approver) {
    return (
      <SignedOut what="what's waiting">
        <LaneTotals totals={await laneTotals(store)} />
      </SignedOut>
    );
  }
  const [data, patients, params] = await Promise.all([today(store), store.listPatients(), searchParams]);
  const item = typeof params.item === "string" ? params.item : undefined;
  return (
    <>
      <TodayBoard data={data} canDecide={approver.role === "pharmacist"} {...(item ? { initial: item } : {})} />
      <PairPhone patients={patients.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} />
      <Card className="mt-6">
        <details>
          <summary className="cursor-pointer text-sm text-ink-3 hover:text-ink">Live event feed (for the team)</summary>
          <EventFeed />
        </details>
      </Card>
    </>
  );
}

export default function TodayPage(props: PageProps<"/app/pharmacy/today">) {
  return (
    <>
      <PageHeader
        title="Today"
        description="What needs a pharmacist, Review first. Everything else went through on its own."
        actions={
          <>
            <Live />
            <a href="/phone" target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
              Open patient phone <span aria-hidden>↗</span>
            </a>
          </>
        }
      />
      <DemoControls />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading the queue…</p>}>
        <Board searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
