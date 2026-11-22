import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { Overnight } from "@/app/console/overnight/Overnight";

export const metadata = { title: "Overnight · Safety suite · Aegis" };

export default function OvernightPage() {
  return (
    <>
      <PageHeader title="Overnight" description="What our own attackers and hammers tried, read from the results they saved. No number on this page is typed in." />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading saved results…</p>}>
        <Overnight />
      </Suspense>
    </>
  );
}
