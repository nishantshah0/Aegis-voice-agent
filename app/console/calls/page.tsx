import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { SignInBar } from "../today/SignInBar";
import { Calls } from "./CallsView";

export const metadata = { title: "Calls · Aegis" };

export default function CallsPage() {
  return (
    <PageShell
      current="/console/today"
      right={
        <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
          <SignInBar />
        </Suspense>
      }
    >
      <ConsoleNav current="calls" />
      <div className="mt-6">
        <PageHeader title="Calls" description="What the voice agent did, from the record: every press, every blocked line, every word." />
      </div>
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading…</p>}>
        <Calls />
      </Suspense>
    </PageShell>
  );
}
