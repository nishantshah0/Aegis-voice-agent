import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, SkeletonRows, SkeletonTiles, When, linkClass } from "@/components/ui";
import { readHammerAndOvernight, resultsDir } from "@/app/console/overnight/results";
import { liveCallRunning } from "@/app/api/_lib/live-calls";
import { readLatestBatch, readLatestRun, shortPath, stillRunning } from "./data";
import { gateDir, readGateRuns, type GateRun } from "@/scripts/gate";
import { AutoRefresh } from "./RunButton";
import { SuiteGate } from "./SignedIn";
import { cacheResult } from "./result-cache";

export const metadata = { title: "Safety suite · Aegis" };

const fmt = (n: number) => n.toLocaleString("en-US");
const checkId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function SuiteOverviewPage() {
  return (
    <SuiteGate>
      <PageHeader
        title="Safety suite"
        description="Release readiness and saved test runs, with each result tied to its source and scope."
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

function LatestGate({ run }: { run: GateRun | undefined }) {
  const required = run?.checks.filter((check) => check.required) ?? [];
  const failed = run?.checks.filter((check) => check.required && !check.passed) ?? [];
  const confirmed = required.length > 0;
  const releasable = Boolean(run?.passed && confirmed);
  return (
    <Card as="section" className="flex flex-col gap-5 border-accent/25 bg-surface p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Release readiness</Eyebrow>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{run ? (releasable ? "Latest gate is releasable" : confirmed ? "Latest gate is not releasable" : "Latest gate is incomplete") : "No release gate run saved"}</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-2">
          {run
              ? !confirmed
                ? "This saved result includes no required checks, so it cannot confirm release readiness."
                : failed.length
                  ? `${failed.length} required check${failed.length === 1 ? "" : "s"} failed in this saved run.`
                  : "All required checks passed in this saved run."
              : "Run the release gate to get a current verdict for this checkout."}
          </p>
        </div>
        <Badge tone={!run || !confirmed ? "neutral" : releasable ? "accent" : "stop"} dot>
          {!run ? "No saved run" : !confirmed ? "Incomplete run" : releasable ? "Releasable" : "Not releasable"}
        </Badge>
      </div>

      {run ? (
        <dl className="grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Run time"><When iso={run.ranAt} /></Meta>
          <Meta label="Commit"><code className="font-mono text-xs">{run.commit.slice(0, 7) || "unknown"}</code></Meta>
          <Meta label="Branch">{run.branch || "Unknown branch"}</Meta>
          <Meta label="Checkout">{run.dirty ? "Had uncommitted changes" : "Clean"}</Meta>
        </dl>
      ) : (
        <p className="border-t border-line pt-4 text-sm text-ink-2">
          Run <code className="font-mono text-xs text-ink">node scripts/gate.ts</code>; its saved result appears here.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-3">Source: <code className="font-mono">results/gate/</code></p>
        <Link href="/app/safety/gate-report" className={linkClass}>{run ? "Review release gate →" : "Open release gate →"}</Link>
      </div>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{children}</dd>
    </div>
  );
}

function AttentionItem({ tone, label, title, detail, href }: { tone: "stop" | "quick" | "neutral"; label: string; title: string; detail: ReactNode; href: string }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <Badge tone={tone} className="mt-0.5">{label}</Badge>
        <div className="min-w-0">
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-sm text-ink-2">{detail}</p>
        </div>
      </div>
      <Link href={href} className="shrink-0 text-sm font-medium text-accent underline underline-offset-2 hover:text-ink">Open evidence →</Link>
    </li>
  );
}

function RunSummary({
  title,
  href,
  ranAt,
  scope,
  result,
  source,
  state,
}: {
  title: string;
  href: string;
  ranAt: string | null;
  scope: string;
  result: string;
  source: string;
  state?: { label: string; tone: "accent" | "stop" | "quick" | "neutral" };
}) {
  return (
    <Card as="article" className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={href} className="font-semibold text-ink underline-offset-2 hover:underline">{title} →</Link>
          <p className="mt-1 text-xs text-ink-3">{ranAt ? <>Saved <When iso={ranAt} /></> : "No saved run"}</p>
        </div>
        {state && <Badge tone={state.tone}>{state.label}</Badge>}
      </div>
      <dl className="grid gap-3 border-t border-line pt-3 text-sm">
        <Meta label="Scope">{scope}</Meta>
        <Meta label="Result">{result}</Meta>
        <Meta label="Source"><code className="break-all font-mono text-[11px]">{source}</code></Meta>
      </dl>
    </Card>
  );
}

const readOverviewResults = cacheResult((dir: string) =>
  Promise.all([readHammerAndOvernight(dir), readLatestBatch(dir, { includeSteps: false })]),
);

async function Overview() {
  await connection();
  const [readResults, run, gateRuns, activeCall] = await Promise.all([
    readOverviewResults(resultsDir()),
    readLatestRun(),
    Promise.resolve(readGateRuns(gateDir())),
    Promise.resolve(liveCallRunning()),
  ]);
  const [view, batch] = readResults;
  const { hammer, overnight } = view;
  const gate = gateRuns[0];
  const running = stillRunning(run);

  const attention: ReactNode[] = [];
  if (!gate) {
    attention.push(
      <AttentionItem key="gate-missing" tone="neutral" label="No saved run" title="Release gate has no saved result" detail="Run and inspect the saved gate before calling this checkout releasable." href="/app/safety/gate-report" />,
    );
  } else {
    if (!gate.checks.some((item) => item.required)) {
      attention.push(
        <AttentionItem key="gate-incomplete" tone="quick" label="Incomplete" title="Release gate has no required checks" detail="This saved run cannot confirm release readiness." href="/app/safety/gate-report" />,
      );
    }
    for (const check of gate.checks.filter((item) => item.required && !item.passed)) {
      attention.push(
        <AttentionItem key={`gate-${check.name}`} tone="stop" label="Blocking" title={`${check.name} failed`} detail={check.detail} href={`/app/safety/gate-report#gate-check-${checkId(check.name)}`} />,
      );
    }
  }
  for (const outcome of run?.outcomes.filter((item) => !item.passed) ?? []) {
    attention.push(
      <AttentionItem key={`scenario-${outcome.id}`} tone="quick" label="Review" title={`Scenario failed: ${outcome.id}`} detail={`From run ${run?.runId}; open the saved case evidence.`} href={`/app/safety/scenarios/${encodeURIComponent(outcome.id)}`} />,
    );
  }
  if (run && !run.completed) {
    attention.push(
      <AttentionItem key="scenario-running" tone="neutral" label="In progress" title="Scenario suite is still running" detail={`Run ${run.runId}; ${fmt(run.outcomes.length)} of ${fmt(run.totalScenarios)} scenarios have results.`} href="/app/safety/scenarios" />,
    );
  }
  for (const gap of overnight.state === "ok" ? overnight.data.gaps : []) {
    attention.push(
      <AttentionItem key={`overnight-${gap.source}-${gap.scenario}`} tone="stop" label="Failure" title={`Overnight gap: ${gap.scenario}`} detail={`${gap.source} · ${gap.detail}`} href="/app/safety/overnight" />,
    );
  }
  if (activeCall) {
    attention.push(
      <AttentionItem key={`live-${activeCall.id}`} tone="neutral" label="In progress" title={`Live call ${activeCall.state}`} detail={<>{activeCall.title} · started <When iso={activeCall.startedAt} /></>} href={`/app/safety/calls/${encodeURIComponent(activeCall.id)}`} />,
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      <AutoRefresh active={running || Boolean(activeCall)} />
      <LatestGate run={gate} />

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Eyebrow>Needs attention</Eyebrow>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Failures and unfinished work</h2>
          </div>
          {attention.length > 0 && <Badge tone="neutral">{attention.length} item{attention.length === 1 ? "" : "s"}</Badge>}
        </div>
        <Card className="mt-3 p-4 md:px-5">
          {attention.length ? (
            <ul className="divide-y divide-line">{attention}</ul>
          ) : (
            <p className="text-sm text-ink-2">No blocking failures or unfinished live calls are reported by the saved results.</p>
          )}
        </Card>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Eyebrow>Latest saved runs</Eyebrow>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Each test population stays separate</h2>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <RunSummary
            title="Hijack batch"
            href="/app/safety/attacks"
            ranAt={batch?.ranAt ?? null}
            scope={batch ? `${fmt(batch.cards)} attack calls in the latest saved batch` : "Latest full hijack batch"}
            result={batch ? `${fmt(batch.runs.filter((item) => item.passed).length)} of ${fmt(batch.cards)} passed · ${fmt(batch.caught)} caught · ${fmt(batch.broken)} broken rules` : "No batch result available"}
            source={batch ? shortPath(batch.path, resultsDir()) : "results/hijack/"}
            state={batch ? (batch.broken ? { label: `${fmt(batch.broken)} broken`, tone: "stop" } : { label: "No broken rules", tone: "accent" }) : { label: "No saved run", tone: "neutral" }}
          />
          <RunSummary
            title="Scenario suite"
            href="/app/safety/scenarios"
            ranAt={run?.ranAt ?? null}
            scope={run ? `Run ${run.runId} · ${fmt(run.totalScenarios)} scenarios · ${fmt(run.outcomes.reduce((n, outcome) => n + outcome.attempts.length, 0))} attempts` : "Latest saved scripted scenario suite"}
            result={run ? `${fmt(run.passed)} of ${fmt(run.totalScenarios)} passed · ${fmt(run.broken)} broken` : "No scenario result available"}
            source={run ? `results/arena/scenarios/${run.runId}/scoreboard.json` : "results/arena/scenarios/"}
            state={run ? (running ? { label: "In progress", tone: "quick" } : run.broken ? { label: "Failures", tone: "stop" } : { label: "Complete", tone: "accent" }) : { label: "No saved run", tone: "neutral"}}
          />
          <RunSummary
            title="Overnight attacker"
            href="/app/safety/overnight"
            ranAt={overnight.state === "ok" ? overnight.ranAt : null}
            scope={overnight.state === "ok" ? `${fmt(overnight.data.calls)} calls from the saved overnight run` : "AI-authored overnight scenarios"}
            result={overnight.state === "ok" ? `${fmt(overnight.data.gaps.length)} gaps · ${fmt(overnight.data.caught)} caught` : overnight.state === "error" ? "Saved result could not be loaded" : "No overnight run saved"}
            source={overnight.state === "ok" ? shortPath(overnight.path, resultsDir()) : overnight.state === "error" ? shortPath(overnight.path, resultsDir()) : overnight.where.replace(resultsDir(), "results")}
            state={overnight.state === "ok" ? (overnight.data.gaps.length ? { label: `${fmt(overnight.data.gaps.length)} gaps`, tone: "stop" } : { label: "No gaps", tone: "accent" }) : { label: overnight.state === "error" ? "Unavailable" : "No saved run", tone: "neutral"}}
          />
          <RunSummary
            title="The hammer"
            href="/app/safety/rules"
            ranAt={hammer.state === "ok" ? hammer.ranAt : null}
            scope={hammer.state === "ok" ? `${fmt(hammer.data.sequences)} press sequences · depth ${fmt(hammer.data.depth)}` : "Exhaustive and random button sequences"}
            result={hammer.state === "ok" ? `${fmt(hammer.data.checks)} invariant checks · ${fmt(hammer.data.broken)} broken` : hammer.state === "error" ? "Saved result could not be loaded" : "No hammer run saved"}
            source={hammer.state === "ok" ? shortPath(hammer.path, resultsDir()) : hammer.state === "error" ? shortPath(hammer.path, resultsDir()) : hammer.where.replace(resultsDir(), "results")}
            state={hammer.state === "ok" ? (hammer.data.broken ? { label: `${fmt(hammer.data.broken)} broken`, tone: "stop" } : { label: "No broken rules", tone: "accent" }) : { label: hammer.state === "error" ? "Unavailable" : "No saved run", tone: "neutral"}}
          />
          <RunSummary
            title="Release gate"
            href="/app/safety/gate-report"
            ranAt={gate?.ranAt ?? null}
            scope={gate ? `${gate.checks.filter((check) => check.required).length} required checks · ${gate.branch || "unknown branch"} · ${gate.commit.slice(0, 7) || "unknown commit"}` : "Latest saved gate run"}
            result={gate ? `${gate.checks.filter((check) => check.required && check.passed).length} of ${gate.checks.filter((check) => check.required).length} required checks passed` : "No gate result available"}
            source="results/gate/"
            state={gate ? (!gate.checks.some((check) => check.required) ? { label: "Incomplete", tone: "neutral" } : gate.passed ? { label: "Releasable", tone: "accent" } : { label: "Not releasable", tone: "stop" }) : { label: "No saved run", tone: "neutral"}}
          />
        </div>
      </section>
    </div>
  );
}
