import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { ReviewCalls } from "@/app/console/review/ReviewCalls";

export const metadata = { title: "Review calls · Pharmacy · Aegis" };

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review calls"
        description="Finished calls from the record. Label each one: right outcome, anything promised wrongly, unsafe or advice-like, tone, and whether to keep it as a test."
      />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Loading finished calls…</p>}>
        <ReviewCalls />
      </Suspense>
    </>
  );
}
