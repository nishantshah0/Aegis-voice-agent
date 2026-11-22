import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { Calls } from "@/app/console/calls/CallsView";

export const metadata = { title: "Calls · Pharmacy · Aegis" };

export default function CallsPage() {
  return (
    <>
      <PageHeader title="Calls" description="What the voice agent did, from the record: every press, every blocked line, every word." />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading…</p>}>
        <Calls />
      </Suspense>
    </>
  );
}
