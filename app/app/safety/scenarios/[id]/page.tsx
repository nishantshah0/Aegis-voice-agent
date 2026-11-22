import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Badge, Card, Eyebrow } from "@/components/ui";
import { groupWords, readAttempts, readCards, readLatestRun, RUN_COMMANDS, shortPath, when, type Entry } from "../../data";
import { AttemptView, type AttemptData } from "./AttemptView";
import { SignInCard, signedIn } from "../../SignedIn";

export const metadata = { title: "Scenario · Safety suite · Aegis" };

// One page per card in scenarios/, known at build time (the shell reads the path, so a
// route with unknown params can't prerender its frame).
export async function generateStaticParams() {
  return (await readCards()).map((card) => ({ id: card.id }));
}

export default function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <Link href="/app/safety/scenarios" className="text-sm text-ink-2 hover:text-ink">
        ← Every scenario
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-ink-3">Reading the scenario…</p>}>
        <Scenario params={params} />
      </Suspense>
    </>
  );
}

/** Each entry's prevHash is the hash of the one before (within this call's record). */
function chainIntact(record: Entry[]): boolean {
  return record.every((e, i) => i === 0 || e.prevHash === record[i - 1]?.hash);
}

const words = (id: string) => {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

async function Scenario({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // Saved runs change: never prerender.
  if (!(await signedIn())) return <SignInCard />; // Checked here too, not only in the shell's layout.
  const { id } = await params;
  const [cards, run] = await Promise.all([readCards(), readLatestRun()]);
  const card = cards.find((c) => c.id === decodeURIComponent(id));
  if (!card) notFound();
  const outcome = run?.outcomes.find((o) => o.id === card.id);
  const files = run && outcome ? await readAttempts(run, card.id) : [];
  const attempts: AttemptData[] = files.map((f) => ({
    n: f.n,
    callId: f.callId,
    file: shortPath(f.path),
    record: f.record,
    score: f.score ?? outcome?.attempts.find((a) => a.n === f.n) ?? null,
    chainIntact: chainIntact(f.record),
  }));

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{groupWords(card.group)}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{words(card.id)}</h1>
          <p className="mt-1.5 max-w-2xl text-[15px] text-ink-2">
            {card.persona}. {card.goal}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!card.inSuite && <Badge>Not in the 28-card suite</Badge>}
          <Badge>{card.direction === "outbound" ? "Outbound call" : "Inbound call"}</Badge>
          {outcome ? (
            <Badge tone={outcome.passed ? "accent" : "stop"} dot>
              {outcome.passed ? "Passed 3 of 3" : "Failed in the latest run"}
            </Badge>
          ) : (
            <Badge>Not run yet</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <Eyebrow>{run ? `Latest run · ${when(run.ranAt)}` : "Latest run"}</Eyebrow>
          <div className="mt-2">
            {attempts.length ? (
              <AttemptView attempts={attempts} />
            ) : (
              <Card className="text-sm text-ink-2">
                <p className="font-medium text-ink">{outcome ? "This run saved no call files for this scenario" : "No saved call for this scenario yet"}</p>
                <p className="mt-1">
                  {card.inSuite ? (
                    <>
                      Run the suite with <code className="font-mono text-xs">{RUN_COMMANDS.suite}</code>. Each call is saved to{" "}
                      <code className="font-mono text-xs">results/arena/scenarios/&lt;run&gt;/</code>.
                    </>
                  ) : (
                    "This card is a regression case, run by the runner's own tests rather than the 28-card suite."
                  )}
                </p>
              </Card>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4 text-sm">
          <Card>
            <Eyebrow>The caller says</Eyebrow>
            <ol className="mt-2 space-y-2">
              {card.callerLines.map((l, i) => (
                <li key={i} className="rounded-lg bg-sunken px-3 py-2 text-ink-2">
                  {l}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-3">
              Seed <span className="font-mono">{card.seed}</span>. Tokens in braces are filled from the seed&apos;s made-up patients.
            </p>
          </Card>
          {(card.must.length > 0 || card.mustNot.length > 0) && (
            <Card>
              <Eyebrow>Expected</Eyebrow>
              <ul className="mt-2 space-y-1">
                {card.must.map((m) => (
                  <li key={`m-${m}`} className="flex gap-2">
                    <span className="text-accent">✓</span>
                    {m}
                  </li>
                ))}
                {card.mustNot.map((m) => (
                  <li key={`n-${m}`} className="flex gap-2" title="Something that must not happen">
                    <span className="text-accent">✓</span>
                    {m}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <Eyebrow>Scored checks</Eyebrow>
            <ul className="mt-2 space-y-1.5">
              {card.checks.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px]">{c.id}</span>
                  <span className="text-xs text-ink-3" title={c.violation ? "Failing this counts as a broken rule" : "Failing this is a wrong outcome, not a broken rule"}>
                    {c.mode}
                    {c.violation ? " · safety" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
