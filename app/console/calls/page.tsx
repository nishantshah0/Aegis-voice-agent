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
      <div className="mt-8" />
      <PageHeader title="Calls" />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading…</p>}>
        <Calls />
      </Suspense>
    </PageShell>
  );
}
