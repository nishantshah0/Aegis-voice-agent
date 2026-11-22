import { Bookings } from "../_parts/BookingsCard";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader, Skeleton, SkeletonRows } from "@/components/ui";
import { PHARMACY_NAV } from "../../_shell/nav";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { upcoming } from "@/app/console/upcoming/upcoming";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { UpcomingTable } from "./UpcomingTable";

export const metadata = { title: `${PHARMACY_NAV.upcoming.label} · Pharmacy · Aegis` };

async function Body() {
  await connection(); // Live data: never prerender.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="upcoming refills" />;
  const canCall =
    approver.role === "pharmacist" || process.env.DEMO_CONTROLS === "on";
  const store = getStore();
  return <><div className="mt-6"><Bookings store={store} /></div><UpcomingTable data={await upcoming(store)} canCall={canCall} canClear={approver.role === "pharmacist"} /></>;
}

export default function UpcomingPage() {
  return (
    <>
      <PageHeader
        title={PHARMACY_NAV.upcoming.label}
        actions={<Live />}
      />
      <Suspense
        fallback={
          <div className="mt-8">
            <Skeleton className="h-36 rounded-card" />
            <SkeletonRows className="mt-6" />
          </div>
        }
      >
        <Body />
      </Suspense>
    </>
  );
}
