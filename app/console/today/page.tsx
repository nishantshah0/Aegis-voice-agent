import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { DemoControls } from "./DemoControls";
import { Queue } from "./Queue";
import { SignInBar } from "./SignInBar";

export const metadata = { title: "Today · Aegis" };

export default function TodayPage() {
  return (
    <PageShell
      current="/console/today"
      width="narrow"
      right={
        <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
          <SignInBar />
        </Suspense>
      }
    >
      <ConsoleNav current="today" />
      <div className="mt-8" />
      <PageHeader title="Today" description="What needs a pharmacist, Review first. Everything else went through on its own." />
      <DemoControls />
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Loading the queue…</p>}>
        <Queue />
      </Suspense>
    </PageShell>
  );
}
