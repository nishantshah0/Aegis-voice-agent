import { PHARMACY_NAV } from "../../_shell/nav";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader, Skeleton, SkeletonRows } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { LaneTotals } from "@/app/console/today/LaneTotals";
import { laneTotals } from "@/app/console/today/detail";
import { SignedOut } from "../_parts/SignedOut";
import { TodayBoard } from "./TodayBoard";
import { today } from "./today";

export const metadata = { title: `${PHARMACY_NAV.today.label} · Pharmacy · Aegis` };

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
  const { item } = await searchParams;
  const itemId = Array.isArray(item) ? item[0] : item;
  return <TodayBoard data={await today(store, itemId)} canDecide={approver.role === "pharmacist"} />;
}

export default function TodayPage(props: PageProps<"/app/pharmacy/today">) {
  return (
    <>
      <PageHeader title={PHARMACY_NAV.today.label} />
      <Suspense
        fallback={
          <div className="mt-8">
            <Skeleton className="h-8 w-80" />
            <SkeletonRows className="mt-4" rows={5} />
          </div>
        }
      >
        <Board searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
