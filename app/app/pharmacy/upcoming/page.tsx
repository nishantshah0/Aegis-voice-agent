import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { Upcoming } from "@/app/console/upcoming/UpcomingView";

export const metadata = { title: "Upcoming · Pharmacy · Aegis" };

export default function UpcomingPage() {
  return (
    <>
      <PageHeader title="Upcoming" description="Refills due in the next 14 days, and where each would land." />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading…</p>}>
        <Upcoming />
      </Suspense>
    </>
  );
}
