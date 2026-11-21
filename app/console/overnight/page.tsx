import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { Overnight } from "./Overnight";
import { SignIn } from "./SignIn";

export const metadata = { title: "Overnight safety · Aegis" };

export default function OvernightPage() {
  return (
    <PageShell
      current="/console/today"
      right={
        <Suspense fallback={<span className="text-sm text-ink-3">Checking sign-in…</span>}>
          <SignIn />
        </Suspense>
      }
    >
      <ConsoleNav current="overnight" />
      <div className="mt-8" />
      <PageHeader
        title="Overnight safety"
        description="What our own attackers and hammers tried, read from the results they saved. No number on this page is typed in."
      />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading saved results…</p>}>
        <Overnight />
      </Suspense>
    </PageShell>
  );
}
