import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { ReviewCalls } from "./ReviewCalls";
import { SignIn } from "./SignIn";

export const metadata = { title: "Call quality · Aegis" };

export default function ReviewPage() {
  return (
    <PageShell
      current="/console/today"
      right={
        <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
          <SignIn />
        </Suspense>
      }
    >
      <ConsoleNav current="review" />
      <div className="mt-8" />
      <PageHeader
        title="Call quality"
        description="Finished calls from the record. Label each one: right outcome, anything promised wrongly, unsafe or advice-like, tone, and whether to keep it as a test."
      />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Loading finished calls…</p>}>
        <ReviewCalls />
      </Suspense>
    </PageShell>
  );
}
