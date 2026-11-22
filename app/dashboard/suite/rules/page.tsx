import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Eyebrow, PageHeader } from "@/components/ui";
import { RuleBook } from "@/app/console/rules/RuleBook";
import { RUN_COMMANDS, readWhy, when, whyGroup } from "../data";
import { WhyList, type WhyItem } from "./WhyList";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Rules · Safety suite · Aegis" };

// The rule book from app/console/rules (imported, not copied), plus why each rule is the
// way it is, from results/why/ (Entire's record of the commit and AI session behind it).
export default function SuiteRulesPage() {
  return (
    <SuiteGate>
      <PageHeader title="Rules" description="The 12 buttons and the speech rules, from the code, with what the latest hammer run found and why each rule is there. Read only." />
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading why each rule exists…</p>}>
        <Why />
      </Suspense>
      <Suspense fallback={<p className="mt-8 text-sm text-ink-3">Reading the rules…</p>}>
        <RuleBook />
      </Suspense>
    </SuiteGate>
  );
}

async function Why() {
  await connection(); // scripts/why.ts rewrites these files: never prerender.
  const why = await readWhy();
  if (!why) {
    return (
      <Card className="mt-8 text-sm text-ink-2">
        <p className="font-medium text-ink">No rule history saved yet</p>
        <p className="mt-1">
          Made by: <code className="font-mono text-xs">{RUN_COMMANDS.why}</code>, saved to <code className="font-mono text-xs">results/why/</code>.
        </p>
      </Card>
    );
  }
  const items: WhyItem[] = why.records.map((r) => ({ ...r, group: whyGroup(r.id) }));
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Why each rule is there</Eyebrow>
        <span className="text-xs text-ink-3">
          {items.length} rules traced to their commit {why.generatedAt ? `· ${when(why.generatedAt)}` : ""} · results/why/
          {why.missing.length ? ` · ${why.missing.length} couldn't be traced` : ""}
        </span>
      </div>
      <div className="mt-2">
        <WhyList items={items} />
      </div>
    </section>
  );
}
