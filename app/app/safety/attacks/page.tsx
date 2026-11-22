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
import { basename } from "node:path";
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
        description="Scripted and generated attempts against the safety lock. Each result links to the saved call record and its checks."
        actions={<AttackerPicker />}
      />
      <Suspense fallback={<SkeletonRows rows={4} className="mt-8" />}>
        <SavedBatch />
      </Suspense>
      <Suspense fallback={<SkeletonRows rows={10} className="mt-8" />}>
        <Library />
      </Suspense>
      <details className="group mt-10 rounded-card border border-line bg-surface shadow-card">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold">Other ways to test the lock <span className="ml-2 text-xs font-normal text-ink-3">Manual exercise and live calls</span></summary>
        <div className="flex flex-col gap-8 border-t border-line px-5 py-5">
          <section>
            <Eyebrow>Manual lock exercise</Eyebrow>
            <p className="mt-1 mb-3 text-sm text-ink-2">Choose what a fully fooled AI tries, one card at a time or in your own words, and inspect how the lock answers each press and sentence.</p>
            <AttackDesk />
          </section>
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Eyebrow>Live attack calls · simulated line</Eyebrow>
              <Link href="/app/safety/live-calls" className="text-xs text-ink-2 underline hover:text-ink">
                Create a custom attack →
              </Link>
            </div>
            <p className="mt-1 text-sm text-ink-2">These run the real agent with an attacker as caller. They create saved call evidence.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STAGE_ATTACKS.map((a) => (
                <Card key={a.id} className="flex flex-col justify-between gap-3">
                  <p className="text-sm font-medium">{a.title}</p>
                  <RunLiveCallButton source={{ kind: "card", id: a.id }} />
                </Card>
              ))}
            </div>
          </section>
        </div>
      </details>
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
        <div>
          <Eyebrow>Latest saved scripted batch</Eyebrow>
          <p className="mt-1 text-xs text-ink-3">Synthetic test calls · Hijack cards · Saved result</p>
        </div>
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
          <p className="font-medium text-ink">No scripted batch saved yet</p>
          <p className="mt-1">Run all attacks below to create a saved batch. Each card links to its call evidence after the run.</p>
        </Card>
      )}
      {batch && (
        <div className="mt-2 grid gap-3">
          {[...batch.runs].sort((a, b) => Number(b.broken > 0 || !b.passed) - Number(a.broken > 0 || !a.passed) || order(a.cardId) - order(b.cardId)).map((r) => (
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-ink-2">
                <span>Source: <code className="font-mono">{shortPath(r.path)}</code></span>
                <Link href={`/app/safety/attacks/hijack/${encodeURIComponent(`${basename(batch.path)}~${r.cardId}`)}`} className="font-medium underline underline-offset-2 hover:text-ink">
                  Open saved call evidence →
                </Link>
              </div>
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

/** The worklist: one run action, a compact coverage reference, and filterable saved results. */
async function Library() {
  await connection(); // Results change as attacks run: never prerender.
  if (!(await signedIn())) return <SignInCard />;
  const attacks = await readLibrary();
  return (
    <div className="mt-8 flex flex-col gap-8">
      <RunAllAttacks attacks={attacks} />

      <section>
        <Eyebrow>Attack worklist</Eyebrow>
        <p className="mt-1 text-sm text-ink-2">Broken checks sort first. Filter by result, category, attacker, or test type; open a saved result to inspect its call record and rule checks.</p>
        <div className="mt-3">
          <LibraryTable attacks={attacks} categories={CATEGORIES} />
        </div>
      </section>

      <details className="rounded-card border border-line bg-surface shadow-card">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold">Category coverage <span className="ml-2 text-xs font-normal text-ink-3">Supporting reference</span></summary>
        <div className="overflow-x-auto border-t border-line">
          <CategoryCoverage attacks={attacks} />
        </div>
      </details>
    </div>
  );
}

function CategoryCoverage({ attacks }: { attacks: Awaited<ReturnType<typeof readLibrary>> }) {
  const rows = coverage(attacks);
  return (
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
                <StackedBar segments={[
                  { label: "Caught", value: r.caught, tone: "accent" },
                  { label: "Held", value: r.held, tone: "review" },
                  { label: "Broken", value: r.broken, tone: "stop" },
                ]} />
              ) : <span className="text-xs text-ink-3">Not run yet</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
