import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader, Skeleton, SkeletonRows } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { LaneTotals } from "@/app/console/today/LaneTotals";
import { laneTotals } from "@/app/console/today/detail";
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
  const [data, params] = await Promise.all([today(store), searchParams]);
  const item = typeof params.item === "string" ? params.item : undefined;
  return <TodayBoard data={data} canDecide={approver.role === "pharmacist"} {...(item ? { initial: item } : {})} />;
}

export default function TodayPage(props: PageProps<"/app/pharmacy/today">) {
  return (
    <>
      <PageHeader
        title="Today"
        description="What needs a pharmacist, Review first. Everything else went through on its own."
        actions={<Live />}
      />
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
