import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { Overnight } from "@/app/console/overnight/Overnight";
import { ArenaRunControl } from "../ArenaRunControl";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Overnight · Safety suite · Aegis" };

// The overnight view from app/console/overnight, imported, not copied.
export default function SuiteOvernightPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Overnight"
        description="What our own attackers and hammers tried while the pharmacy slept, read from the results they saved. No number here is typed in."
        actions={<ArenaRunControl kind="overnight" label="Run overnight" compact />}
      />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading saved results…</p>}>
        <Overnight />
      </Suspense>
    </SuiteGate>
  );
}
