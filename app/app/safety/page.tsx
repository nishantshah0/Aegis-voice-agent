import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, SkeletonRows, SkeletonTiles, When, cn, linkClass } from "@/components/ui";
import { readOvernight, type Source } from "@/app/console/overnight/results";
import { readLatestBatch, readLatestRun, stillRunning } from "./data";
import { listLiveCalls } from "@/app/api/_lib/live-calls";
import { RecentLiveCalls } from "./live-calls/RecentLiveCalls";
import { Progress } from "./Progress";
import { ArenaRunControl } from "./ArenaRunControl";
import { AutoRefresh, RunButton } from "./RunButton";
import { SuiteGate } from "./SignedIn";

export const metadata = { title: "Safety suite · Aegis" };

const fmt = (n: number) => n.toLocaleString("en-US");

export default function SuiteOverviewPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Safety suite"
        description="Everything we throw at the lock, and what it stopped. Every number is read from a file a real run saved under results/."
      />
      <Suspense
        fallback={
          <div className="mt-8 flex flex-col gap-8">
            <SkeletonTiles />
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <Overview />
      </Suspense>
    </SuiteGate>
  );
}

/** One part of "rules broken", with where it came from. */
type Part = { label: string; broken: number | null };

function Hero({ broken, parts }: { broken: number | null; parts: Part[] }) {
  const tone = broken === null ? "text-ink-3" : broken === 0 ? "text-accent" : "text-stop";
  return (
    <Card className="flex flex-col justify-between gap-6 p-7 md:col-span-2 md:row-span-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-2">Rules broken</span>
        <Badge tone={broken === 0 ? "accent" : broken === null ? "neutral" : "stop"} dot>
          {broken === null ? "No saved runs" : broken === 0 ? "Held every time" : "Look at the failures"}
        </Badge>
      </div>
      <span className={cn("text-[8rem] leading-none font-semibold tabular-nums tracking-[-0.06em] md:text-[10rem]", tone)}>{broken === null ? "—" : fmt(broken)}</span>
      <ul className="flex flex-wrap gap-2">
        {parts.map((p) => (
          <li
            key={p.label}
            title={p.broken === null ? `${p.label}: no saved run yet` : `${p.label}: ${fmt(p.broken)} broken in the latest saved run`}
            className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-2"
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", p.broken === null ? "bg-ink-3" : p.broken === 0 ? "bg-accent" : "bg-stop")} />
            {p.label}
            <span className="font-semibold tabular-nums text-ink">{p.broken === null ? "—" : fmt(p.broken)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <span className="text-4xl font-semibold tabular-nums tracking-[-0.03em]">{value}</span>
      <span className="text-xs text-ink-3">{hint}</span>
    </Card>
  );
}

function RunCard({
  title,
  href,
  ranAt,
  run,
  children,
  live,
}: {
  title: string;
  href: string;
  ranAt: string | null;
  run: ReactNode;
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <Card as="section" className="flex flex-col gap-4 transition-shadow hover:border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={href} className="text-[15px] font-semibold hover:underline">
            {title} →
          </Link>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            {live && <span aria-hidden className="size-1.5 rounded-full bg-accent animate-pulse" />}
            {ranAt ? (
              <>
                Last run <When iso={ranAt} />
              </>
            ) : (
              "No run yet"
            )}
          </p>
        </div>
        {run}
      </div>
      <div className="text-sm text-ink-2">{children}</div>
    </Card>
  );
}

function Mini({ items }: { items: [string, number | string][] }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-ink-3">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums text-ink">{typeof value === "number" ? fmt(value) : value}</dd>
        </div>
      ))}
    </dl>
  );
}

const ranAtOf = <T,>(s: Source<T>) => (s.state === "ok" ? s.ranAt : null);
const brokenOf = <T extends { broken: number }>(s: Source<T>) => (s.state === "ok" ? s.data.broken : null);


async function Overview() {
  await connection(); // Files change between runs: never prerender.
  const [view, run, batch, live] = await Promise.all([readOvernight(), readLatestRun(), readLatestBatch(), listLiveCalls(5)]);
  const { hammer, overnight } = view;
  const running = stillRunning(run);

  // Every number here comes from the same files as the run cards below: the newest full
  // hijack batch (not a single stage pick), the newest scenario run, the overnight report
  // and the hammer, so the tiles and the cards always agree.
  const sources = [
    batch ? { calls: batch.cards, caught: batch.caught, broken: batch.broken } : null,
    run ? { calls: run.outcomes.reduce((n, o) => n + o.attempts.length, 0), caught: run.caught, broken: run.broken } : null,
    overnight.state === "ok" ? { calls: overnight.data.calls, caught: overnight.data.caught, broken: overnight.data.broken } : null,
    hammer.state === "ok" ? { calls: 0, caught: 0, broken: hammer.data.broken } : null,
  ].filter((s): s is { calls: number; caught: number; broken: number } => s !== null);
  const totals = sources.length
    ? sources.reduce((t, s) => ({ calls: t.calls + s.calls, caught: t.caught + s.caught, broken: t.broken + s.broken }), { calls: 0, caught: 0, broken: 0 })
    : null;

  const parts: Part[] = [
    { label: "Hammer", broken: brokenOf(hammer) },
    { label: "Hijack batch", broken: batch?.broken ?? null },
    { label: "Scenarios", broken: run?.broken ?? null },
    { label: "Overnight", broken: brokenOf(overnight) },
  ];

  return (
    <div className="mt-8 flex flex-col gap-8">
      <AutoRefresh active={running} />
      <div className="grid gap-4 md:grid-cols-4">
        <Hero broken={totals ? totals.broken : null} parts={parts} />
        <Figure
          label="Attacks caught"
          value={totals ? fmt(totals.caught) : "—"}
          hint="Blocked presses and lines across the hijack batch, scenarios and overnight runs"
        />
        <Figure
          label="Hostile presses"
          value={hammer.state === "ok" ? fmt(hammer.data.presses) : "—"}
          hint={
            hammer.state === "ok" ? (
              <>
                {fmt(hammer.data.sequences)} sequences in the last hammer run, <When iso={hammer.ranAt} />
              </>
            ) : (
              "No hammer run saved yet (npm run hammer)"
            )
          }
        />
        <Figure
          label="Invariant checks"
          value={hammer.state === "ok" ? fmt(hammer.data.checks) : "—"}
          hint={hammer.state === "ok" ? `Every sequence up to ${fmt(hammer.data.depth)} presses, plus random ones` : "No hammer run saved yet"}
        />
        <Figure
          label="Calls made"
          value={totals ? fmt(totals.calls) : "—"}
          hint="Each one through the same AgentDriver, 12 buttons and speech guard"
        />
      </div>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>Recent live calls</Eyebrow>
          {live.length > 0 && (
            <Link href="/app/safety/live-calls" className="text-xs text-ink-2 underline hover:text-ink">
              Run a live attack call →
            </Link>
          )}
        </div>
        <div className="mt-2">
          <RecentLiveCalls
            calls={live}
            empty="No live call yet: an attacker AI ringing the real agent, with both sides voiced."
            action={
              <Link href="/app/safety/live-calls" className={linkClass}>
                Start a live call
              </Link>
            }
          />
        </div>
      </section>

      <section>
        <Eyebrow>Runs</Eyebrow>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <RunCard title="Hijack batch" href="/app/safety/attacks" ranAt={batch?.ranAt ?? null} run={<RunButton url="/api/arena/hijack" label="Run batch" />}>
            {batch ? (
              <Mini items={[["Attack calls", batch.cards], ["Caught", batch.caught], ["Broken", batch.broken]]} />
            ) : (
              <p>A fully fooled AI tries four attacks through the real lock.</p>
            )}
          </RunCard>

          <RunCard
            title="Scenario suite"
            href="/app/safety/scenarios"
            ranAt={run?.ranAt ?? null}
            live={running}
            run={process.env.AEGIS_PUBLIC_ORIGIN ? (
              <a className="underline" href="/app/safety/business-tests">Open live suite</a>
            ) : <ArenaRunControl kind="suite" label="Run suite" compact />}
          >
            {run ? (
              <div className="flex flex-col gap-3">
                <Mini items={[["Passing 3 of 3", `${fmt(run.passed)} / ${fmt(run.outcomes.length)}`], ["Caught", run.caught], ["Broken", run.broken]]} />
                <Progress done={run.outcomes.length} total={run.totalScenarios} live={running} />
              </div>
            ) : (
              <p>28 scripted callers, three calls each, scored from the record.</p>
            )}
          </RunCard>

          <RunCard
            title="Overnight attacker"
            href="/app/safety/overnight"
            ranAt={ranAtOf(overnight)}
            run={<ArenaRunControl kind="overnight" label="Run overnight" compact />}
          >
            {overnight.state === "ok" ? (
              <Mini items={[["Calls", overnight.data.calls], ["Caught", overnight.data.caught], ["Gaps found", overnight.data.gaps.length]]} />
            ) : (
              <p>An AI attacker writes new scenarios against the lock while the pharmacy sleeps.</p>
            )}
          </RunCard>

          <RunCard
            title="The hammer"
            href="/app/safety/rules"
            ranAt={ranAtOf(hammer)}
            run={<RunButton label="Run hammer" disabledReason="Runs from a terminal: npm run hammer" />}
          >
            {hammer.state === "ok" ? (
              <Mini items={[["Sequences", hammer.data.sequences], ["Presses", hammer.data.presses], ["Broken", hammer.data.broken]]} />
            ) : (
              <p>Every press sequence, straight at the control layer, with no AI at all.</p>
            )}
          </RunCard>
        </div>
      </section>
    </div>
  );
}
