import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Eyebrow, PageHeader, SkeletonRows } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { SuiteGate } from "../SignedIn";
import { RuleWriter } from "./RuleWriter";

export const metadata = { title: "Rule writer · Safety suite · Aegis" };

// AUDIT #9 (Trail #78): SPEC "The rule writer". A pharmacist types a rule and gets a DRAFT
// card (POST /api/rules/draft). Nothing goes live until a pharmacist approves it, and only
// lib/control's applyApprovedCard can add it to the live cards.

async function Writer() {
  await connection();
  const approver = await getApprover();
  const written = (await getStore().listCards()).filter((c) => c.author.startsWith("rule writer"));
  return (
    <>
      <RuleWriter canWrite={approver?.role === "pharmacist"} />
      <section className="mt-10">
        <Eyebrow>Written rules live now</Eyebrow>
        {written.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">None yet. The team&apos;s rule cards (2a to 11) are on the Rules page.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {written.map((c) => (
              <li key={c.id}>
                <Card className="text-sm">
                  <span className="font-mono text-xs text-ink-3">{c.id}</span> <span className="font-medium text-ink">{c.wording}</span>
                  <p className="mt-1 text-ink-2">
                    {c.then} · approved by {c.approvedBy} at {c.approvedAt}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-3">Written rules live in the running store. A demo reset puts the team&apos;s starting cards back.</p>
      </section>
    </>
  );
}

export default function RuleWriterPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Rule writer"
        description="Type a rule in plain English. The AI drafts a card; code checks it, runs its three tests and shows what it would have caught. A pharmacist approves it before it's live."
      />
      <Suspense fallback={<SkeletonRows rows={4} className="mt-8" />}>
        <Writer />
      </Suspense>
    </SuiteGate>
  );
}
