import { Suspense } from "react";
import { connection } from "next/server";
import { ButtonLink, PageHeader } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { upcoming } from "@/app/console/upcoming/upcoming";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { UpcomingTable } from "./UpcomingTable";

export const metadata = { title: "Upcoming · Pharmacy · Aegis" };

async function Body() {
  await connection(); // Live data: never prerender.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="upcoming refills" />;
  const canCall =
    approver.role === "pharmacist" || process.env.DEMO_CONTROLS === "on";
  return <UpcomingTable data={await upcoming(getStore())} canCall={canCall} />;
}

export default function UpcomingPage() {
  return (
    <>
      <PageHeader
        title="Upcoming"
        description="Who runs out when, where each refill would land, and who the daily check rings next."
        actions={
          <>
            <Live />
            <ButtonLink
              href="/app/pharmacy/outreach"
              variant="secondary"
              size="sm"
            >
              See 30-day forecast
            </ButtonLink>
          </>
        }
      />
      <div className="mt-6" />
      <Suspense fallback={<p className="text-sm text-ink-3">Loading…</p>}>
        <Body />
      </Suspense>
    </>
  );
}
