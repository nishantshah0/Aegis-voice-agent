import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { SignInBar } from "../today/SignInBar";
import { Upcoming } from "./UpcomingView";

export const metadata = { title: "Upcoming · Aegis" };

export default function UpcomingPage() {
  return (
    <PageShell
      current="/console/today"
      right={
        <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
          <SignInBar />
        </Suspense>
      }
    >
      <ConsoleNav current="upcoming" />
      <div className="mt-6">
        <PageHeader title="Upcoming" description="Refills due in the next 14 days, and where each would land." />
      </div>
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading…</p>}>
        <Upcoming />
      </Suspense>
    </PageShell>
  );
}
