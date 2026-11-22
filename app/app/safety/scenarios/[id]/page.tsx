import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Badge, Card, Eyebrow, PageHeader, RuleTag } from "@/components/ui";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import { describeEntry, groupLabel, scenarioDetail } from "../data";

export const metadata = { title: "Scenario · Safety suite · Aegis" };

// One page per team card, known at build time.
export async function generateStaticParams() {
  return (await loadScenarioSuite()).map((card) => ({ id: card.id }));
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const detail = await scenarioDetail(decodeURIComponent(id));
  if (!detail) notFound();
  const { card, run, attempts } = detail;
  const checks = card.expected.checks ?? [];
  return (
    <>
      <Link href="/app/safety/scenarios" className="text-sm text-ink-3 hover:text-ink">
        ← All scenarios
      </Link>
      <div className="mt-4">
        <PageHeader title={card.persona ?? card.id} description={card.goal} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{groupLabel(card.group)}</Badge>
        <Badge>{card.direction ?? "inbound"}</Badge>
        {card.needsPharmacist && <Badge tone="review">Needs a pharmacist</Badge>}
        <span className="font-mono text-xs leading-6 text-ink-3">{card.id}</span>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <Eyebrow>What the caller says</Eyebrow>
          <ol className="mt-3 space-y-2 text-sm">
            {card.caller_lines.map((line, i) => (
              <li key={i} className="rounded-xl bg-sunken px-3 py-2 text-ink">
                {line}
              </li>
            ))}
          </ol>
          {card.plan && <p className="mt-4 text-sm text-ink-2">{card.plan}</p>}
        </Card>
        <Card>
          <Eyebrow>Scored from the record</Eyebrow>
          <ul className="mt-3 space-y-2 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <RuleTag>{c.mode}</RuleTag>
                <span className="text-ink">{c.id.replace(/_/g, " ")}</span>
                {c.violation && <Badge tone="stop">breaks a rule</Badge>}
              </li>
            ))}
          </ul>
          {(card.expected.must_not?.length ?? 0) > 0 && (
            <p className="mt-4 text-sm text-ink-2">Must not: {card.expected.must_not!.join(", ")}.</p>
          )}
        </Card>
      </div>

      <h2 className="mt-10 text-xl font-semibold tracking-[-0.02em]">Latest attempts</h2>
      {!run || attempts.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">
          Not run yet. A suite run saves three attempts for this card, each with its record.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {attempts.map((a) => (
            <Card key={a.n}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Attempt {a.n}</span>
                <Badge tone={a.score.automatedPassed ? "accent" : "stop"} dot>
                  {a.score.automatedPassed ? "Passed" : "Failed"}
                </Badge>
                <span className="text-xs text-ink-3">
                  {a.score.caught} caught · {a.score.broken} broken · <span className="font-mono">{a.score.callId}</span>
                </span>
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {a.score.checks.map((c) => (
                  <li key={c.id}>
                    <Badge tone={c.passed ? "accent" : "stop"}>{c.id.replace(/_/g, " ")}</Badge>
                  </li>
                ))}
              </ul>
              {a.run && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent">Record ({a.run.record.length} entries, hash-chained)</summary>
                  <ol className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl bg-sunken p-3 font-mono text-xs text-ink-2">
                    {a.run.record.map((e) => (
                      <li key={e.id}>
                        <span className="text-ink-3">#{e.seq}</span> {describeEntry(e)} <span className="text-ink-3">{e.hash.slice(0, 8)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function ScenarioPage({ params }: PageProps<"/app/safety/scenarios/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">Reading the scenario…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
