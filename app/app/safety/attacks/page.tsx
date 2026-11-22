import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, SkeletonRows, When } from "@/components/ui";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { readLatestBatch, shortPath } from "../data";
import { BATCH_ORDER } from "./progress";
import { AttackDesk } from "./AttackDesk";
import { RunLiveCallButton } from "../live-calls/RunLiveCallButton";
import Link from "next/link";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Attacks · Safety suite · Aegis" };

export default function AttacksPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Attacks"
        description="Swap in an AI that does whatever it's asked, then watch the lock answer. One card at a time, your own words, or the whole batch."
      />
      <div className="mt-8">
        <AttackDesk />
      </div>
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>Or ring the real agent with an attacker AI</Eyebrow>
          <Link href="/app/safety/live-calls" className="text-xs text-ink-2 underline hover:text-ink">
            Create your own attack →
          </Link>
        </div>
        <p className="mt-1 text-sm text-ink-2">The cards above swap in a fooled AI. A live call keeps the real agent and lets an attacker talk to it instead, out loud, on a simulated line.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STAGE_ATTACKS.map((a) => (
            <Card key={a.id} className="flex flex-col justify-between gap-3">
              <p className="text-sm font-medium">{a.title}</p>
              <RunLiveCallButton source={{ kind: "card", id: a.id }} />
            </Card>
          ))}
        </div>
      </section>
      <Suspense fallback={<SkeletonRows rows={4} className="mt-10" />}>
        <SavedBatch />
      </Suspense>
    </SuiteGate>
  );
}

const TITLE = new Map(STAGE_ATTACKS.map((a) => [a.id as string, a.title]));
const order = (card: string) => (BATCH_ORDER as readonly string[]).indexOf(card);

/** The newest batch saved under results/hijack/: each card's score and its record, step by step. */
async function SavedBatch() {
  await connection(); // A new batch saves new files: never prerender.
  const batch = await readLatestBatch();
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Latest saved batch</Eyebrow>
        {batch && (
          <span className="text-xs text-ink-3">
            <When iso={batch.ranAt} /> · {batch.batches} saved in all ·{" "}
            <code className="font-mono" title={batch.path}>
              {shortPath(batch.path)}
            </code>
          </span>
        )}
      </div>
      {!batch && (
        <Card className="mt-2 text-sm text-ink-2">
          <p className="font-medium text-ink">No batch saved yet</p>
          <p className="mt-1">Press Run batch above. Each card&apos;s result is saved to results/hijack/ before its score shows.</p>
        </Card>
      )}
      {batch && (
        <div className="mt-2 grid gap-3">
          {[...batch.runs].sort((a, b) => order(a.cardId) - order(b.cardId)).map((r) => (
            <details key={r.path} className="group rounded-card border border-line bg-surface shadow-card">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4">
                <span className="text-[15px] font-semibold">{TITLE.get(r.cardId) ?? r.cardId}</span>
                <span className="font-mono text-xs text-ink-3">{r.callId}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Badge tone="review">{`${r.caught} caught`}</Badge>
                  <Badge tone={r.broken === 0 ? "accent" : "stop"} dot>{`${r.broken} broken`}</Badge>
                  <Badge tone={r.passed ? "accent" : "stop"}>{r.passed ? "All checks passed" : `Failed: ${r.failedChecks.join(", ")}`}</Badge>
                  <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-90">›</span>
                </span>
              </summary>
              <ol className="space-y-1.5 border-t border-line px-5 py-4 font-mono text-[13px]">
                {r.steps.map((step, i) => (
                  <li key={i} className={step.startsWith("Blocked") || step.includes(": refused") || step.includes(": blocked") ? "text-stop" : "text-ink-2"}>
                    <span className="mr-2 text-ink-3">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
