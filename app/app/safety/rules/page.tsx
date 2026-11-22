import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { RuleBook } from "@/app/console/rules/RuleBook";
import { Why, WhyHeading } from "./Why";

export const metadata = { title: "Rules · Safety suite · Aegis" };

export default function RulesPage() {
  return (
    <>
      <PageHeader title="Rules" description="The 12 buttons and the speech rules, from the code, with what the latest hammer run found. Read only." />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading the rules…</p>}>
        <RuleBook />
      </Suspense>
      <WhyHeading />
      <Suspense fallback={<p className="mt-4 text-sm text-ink-3">Reading the why export…</p>}>
        <Why />
      </Suspense>
    </>
  );
}
