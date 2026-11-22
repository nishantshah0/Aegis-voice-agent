import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, SkeletonRows, StackedBar, When } from "@/components/ui";
import { STAGE_ATTACKS } from "@/app/stage/attacks";
import { readLatestBatch, shortPath } from "../data";
import { BATCH_ORDER } from "./progress";
import { AttackDesk } from "./AttackDesk";
import { RunLiveCallButton } from "../live-calls/RunLiveCallButton";
import { AttackerPicker } from "../AttackerPicker";
import Link from "next/link";
import { SignInCard, SuiteGate, signedIn } from "../SignedIn";
import { CATEGORIES, coverage, readLibrary } from "./library";
import { LibraryTable } from "./LibraryTable";
import { RunAllAttacks } from "./RunAllAttacks";

export const metadata = { title: "Attack library · Safety suite · Aegis" };

export default function AttacksPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Attack library"
        description="Every attack we throw at the lock, tagged with the category it belongs to and the rule that should stop it, with its last real result. Run one, or run them all."
        actions={<AttackerPicker />}
      />
      <Suspense fallback={<SkeletonRows rows={10} className="mt-8" />}>
        <Library />
      </Suspense>
      <section className="mt-12">
        <Eyebrow>Watch one: swap in a fully hijacked AI</Eyebrow>
        <p className="mt-1 mb-3 text-sm text-ink-2">Pick what a completely fooled AI tries, one card at a time or in your own words, and watch the lock answer each press and sentence.</p>
        <AttackDesk />
      </section>
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

/** The library itself: run all, coverage by category, and every attack in one table. */
async function Library() {
  await connection(); // Results change as attacks run: never prerender.
  if (!(await signedIn())) return <SignInCard />;
  const attacks = await readLibrary();
  const rows = coverage(attacks);
  const ran = attacks.filter((a) => a.last);
  const broken = ran.filter((a) => a.last?.result === "broken").length;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-[13px] font-medium text-ink-2">Attacks in the library</p>
          <p className="text-3xl font-semibold tabular-nums">{attacks.length}</p>
          <p className="text-xs text-ink-3">{CATEGORIES.length} categories</p>
        </Card>
        <Card>
          <p className="text-[13px] font-medium text-ink-2">Run at least once</p>
          <p className="text-3xl font-semibold tabular-nums">{ran.length}</p>
          <p className="text-xs text-ink-3">{attacks.length - ran.length} not run yet</p>
        </Card>
        <Card>
          <p className="text-[13px] font-medium text-ink-2">Caught by the lock</p>
          <p className="text-3xl font-semibold tabular-nums text-accent">{ran.filter((a) => a.last?.result === "caught").length}</p>
          <p className="text-xs text-ink-3">{ran.filter((a) => a.last?.result === "held").length} more held with nothing to block</p>
        </Card>
        <Card>
          <p className="text-[13px] font-medium text-ink-2">Broke a rule</p>
          <p className={broken ? "text-3xl font-semibold tabular-nums text-stop" : "text-3xl font-semibold tabular-nums text-accent"}>{broken}</p>
          <p className="text-xs text-ink-3">In each attack&apos;s last saved run</p>
        </Card>
      </div>

      <RunAllAttacks attacks={attacks} />

      <section>
        <Eyebrow>Coverage by category</Eyebrow>
        <p className="mt-1 text-sm text-ink-2">The OWASP Top 10 for LLM apps categories that apply to a phone agent, plus social engineering and pharmacy abuse. The tags are our reading of each attack; the results are from saved runs.</p>
        <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Attacks</th>
                <th className="px-4 py-2 text-right font-medium">Run</th>
                <th className="w-64 px-4 py-2 font-medium">Caught · held · broken</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-ink">{r.category.label}</span>
                    <span className="text-xs text-ink-3">{r.category.family}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.attacks}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.run}</td>
                  <td className="px-4 py-2.5">
                    {r.run ? (
                      <StackedBar
                        segments={[
                          { label: "Caught", value: r.caught, tone: "accent" },
                          { label: "Held", value: r.held, tone: "review" },
                          { label: "Broken", value: r.broken, tone: "stop" },
                        ]}
                      />
                    ) : (
                      <span className="text-xs text-ink-3">Not run yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <Eyebrow>Every attack</Eyebrow>
        <div className="mt-3">
          <LibraryTable attacks={attacks} categories={CATEGORIES} />
        </div>
      </section>
    </div>
  );
}
