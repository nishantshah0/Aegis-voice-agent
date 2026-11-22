import { Suspense } from "react";
import { PageHeader, buttonClass } from "@/components/ui";
import { DemoControls } from "@/app/console/today/DemoControls";
import { Queue } from "@/app/console/today/Queue";

export const metadata = { title: "Today · Pharmacy · Aegis" };

export default function TodayPage() {
  return (
    <>
      <PageHeader
        title="Today"
        description="What needs a pharmacist, Review first. Everything else went through on its own."
        actions={
          <a href="/phone" target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            Open patient phone <span aria-hidden>↗</span>
          </a>
        }
      />
      <DemoControls />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading the queue…</p>}>
        <Queue />
      </Suspense>
    </>
  );
}
