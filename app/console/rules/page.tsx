import { Suspense } from "react";
import { ConsoleNav, PageHeader, PageShell } from "@/components/ui";
import { RuleBook } from "./RuleBook";

export const metadata = { title: "Rules · Aegis" };

export default function RulesPage() {
  return (
    <PageShell current="/console/today">
      <ConsoleNav current="rules" />
      <div className="mt-8" />
      <PageHeader title="Rules" description="The 12 buttons and the speech rules, from the code, with what the latest hammer run found. Read only." />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading the rules…</p>}>
        <RuleBook />
      </Suspense>
    </PageShell>
  );
}
