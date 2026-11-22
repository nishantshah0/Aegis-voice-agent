import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Button, Card, Eyebrow, PageHeader, SkeletonRows, When, inputClass } from "@/components/ui";
import { gateDir, readGateRuns, type GateCheck, type GateRun } from "@/scripts/gate";
import { SignInCard, SuiteGate, signedIn } from "../SignedIn";

export const metadata = { title: "Release gate · Safety suite · Aegis" };

// Results are read only from the files that `node scripts/gate.ts` saves under results/gate/.
const COMMAND = "node scripts/gate.ts";
const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);
const short = (sha: string) => sha.slice(0, 7) || "unknown";
const checkId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Verdict({ run }: { run: GateRun }) {
  const hasRequiredChecks = run.checks.some((check) => check.required);
  const releasable = run.passed && hasRequiredChecks;
  return <Badge tone={!hasRequiredChecks ? "neutral" : releasable ? "accent" : "stop"} dot>{!hasRequiredChecks ? "Cannot confirm" : releasable ? "Releasable" : "Not releasable"}</Badge>;
}

function Where({ run }: { run: GateRun }) {
  return (
    <div className="grid gap-x-4 gap-y-1 text-sm text-ink-2 sm:grid-cols-2 lg:grid-cols-4">
      <p><span className="text-ink-3">Commit </span><code className="font-mono text-xs text-ink">{short(run.commit)}</code></p>
      <p><span className="text-ink-3">Branch </span><span className="text-ink">{run.branch || "unknown branch"}</span></p>
      <p><span className="text-ink-3">Run </span><When iso={run.ranAt} /></p>
      <p><span className="text-ink-3">Duration </span>{secs(run.ms)}</p>
      <p className="sm:col-span-2 lg:col-span-4"><span className="text-ink-3">Checkout </span>{run.dirty ? <Badge tone="quick">Had uncommitted changes</Badge> : "Clean"}</p>
    </div>
  );
}

function CheckRow({ check, open = false }: { check: GateCheck; open?: boolean }) {
  const text = check.passed ? "Passed" : check.required ? "Failed · blocks release" : "Failed · informational";
  const tone = check.passed ? "accent" : check.required ? "stop" : "neutral";
  return (
    <li id={`gate-check-${checkId(check.name)}`} className="scroll-mt-6 border-t border-line first:border-t-0">
      <details open={open}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="font-mono text-sm text-ink-2">{check.passed ? "✓" : check.required ? "!" : "–"}</span>
            <span className="font-medium text-ink">{check.name}</span>
            <Badge tone={tone}>{text}</Badge>
          </span>
          <span className="text-xs text-ink-3">{check.ms > 0 ? secs(check.ms) : "Duration unavailable"}</span>
        </summary>
        <div className="mb-4 ml-7 rounded-card bg-sunken p-3 text-sm text-ink-2">
          <p className="text-xs font-medium text-ink-3">Saved output summary</p>
          <p className="mt-1 break-words">{check.detail || "No output summary was saved for this check."}</p>
          <p className="mt-3 text-xs text-ink-3">{check.required ? "Required check: its result decides the gate." : "Optional check: shown for context and does not decide release readiness."}</p>
        </div>
      </details>
    </li>
  );
}

function CheckList({ run }: { run: GateRun }) {
  const required = run.checks.filter((check) => check.required).sort((a, b) => Number(a.passed) - Number(b.passed));
  const optional = run.checks.filter((check) => !check.required);
  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="required-checks-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="required-checks-heading" className="font-semibold text-ink">Required checks</h3>
          <p className="text-xs text-ink-3">{required.filter((check) => check.passed).length} of {required.length} passed</p>
        </div>
        {required.length ? <ul className="mt-2">{required.map((check) => <CheckRow key={check.name} check={check} open={!check.passed} />)}</ul> : <p className="mt-2 text-sm text-ink-2">No required checks were recorded. This run cannot confirm release readiness.</p>}
      </section>
      {optional.length > 0 && (
        <section aria-labelledby="optional-checks-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="optional-checks-heading" className="font-semibold text-ink">Informational checks</h3>
            <p className="text-xs text-ink-3">These results do not decide the gate.</p>
          </div>
          <ul className="mt-2">{optional.map((check) => <CheckRow key={check.name} check={check} open={!check.passed} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Comparison({ latest, baseline }: { latest: GateRun; baseline: GateRun }) {
  const baselineChecks = new Map(baseline.checks.map((check) => [check.name, check]));
  const latestNames = new Set(latest.checks.map((check) => check.name));
  const common = latest.checks.filter((check) => baselineChecks.has(check.name) && baselineChecks.get(check.name)?.required === check.required);
  const changed = common.filter((check) => baselineChecks.get(check.name)?.passed !== check.passed);
  const differentChecks = latest.checks.length !== baseline.checks.length || latest.checks.some((check) => !baselineChecks.has(check.name) || baselineChecks.get(check.name)?.required !== check.required) || baseline.checks.some((check) => !latestNames.has(check.name));
  const differentBranch = latest.branch !== baseline.branch;
  const hasDirty = latest.dirty || baseline.dirty;

  return (
    <Card as="section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Run comparison</Eyebrow>
          <h2 className="mt-1 text-lg font-semibold">Selected saved run</h2>
        </div>
        <Verdict run={baseline} />
      </div>
      <div className="mt-3 grid gap-2 border-b border-line pb-4 text-sm sm:grid-cols-2">
        <p>Compare <code className="font-mono text-xs">{short(latest.commit)}</code> · {latest.branch || "unknown branch"} · <When iso={latest.ranAt} /></p>
        <p>With <code className="font-mono text-xs">{short(baseline.commit)}</code> · {baseline.branch || "unknown branch"} · <When iso={baseline.ranAt} /></p>
      </div>
      {(differentChecks || differentBranch || hasDirty) && (
        <p className="mt-3 rounded-card bg-sunken p-3 text-sm text-ink-2">
          {differentChecks && "The saved check sets differ; only checks with the same name and required status are compared. "}
          {differentBranch && "These runs are from different branches. "}
          {hasDirty && "At least one run included uncommitted changes. "}
          Checkouts with different scopes should be read as separate evidence.
        </p>
      )}
      <p className="mt-3 text-sm text-ink-2">
        {changed.length ? `${changed.length} matching check${changed.length === 1 ? "" : "s"} changed: ${changed.map((check) => `${check.name} ${check.passed ? "now passes" : "now fails"}`).join(", ")}.` : "No matching check changed result."}
      </p>
      <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
        {latest.checks.map((check) => {
          const prior = baselineChecks.get(check.name);
          const comparable = prior && prior.required === check.required;
          return (
            <li key={check.name} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="font-medium">{check.name}{!check.required && <span className="ml-2 text-xs font-normal text-ink-3">informational</span>}</span>
              <span className="text-ink-2">{comparable ? `${prior.passed ? "Passed" : "Failed"} → ${check.passed ? "Passed" : "Failed"}` : "No comparable check in selected run"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

async function GateReport({ requestedCompare }: { requestedCompare?: string }) {
  await connection();
  if (!(await signedIn())) return <SignInCard />;
  const runs = readGateRuns(gateDir());
  if (!runs.length) {
    return (
      <Card className="mt-8 text-sm text-ink-2">
        <Badge tone="neutral">No saved run</Badge>
        <p className="mt-3 font-medium text-ink">No release gate run is available yet</p>
        <p className="mt-1">Run <code className="font-mono text-xs text-ink">{COMMAND}</code>. It runs typecheck, lint, tests, the hammers and the build, and saves the result under <code className="font-mono text-xs">results/gate/</code>.</p>
      </Card>
    );
  }

  const [latest, ...older] = runs;
  const comparison = requestedCompare ? older.find((run) => run.ranAt === requestedCompare) : older[0];
  const invalidCompare = Boolean(requestedCompare && !comparison);
  return (
    <div className="mt-8 space-y-6">
      <Card as="section">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Eyebrow>Latest saved run</Eyebrow>
            <h2 className="mt-1 text-xl font-semibold">{!latest.checks.some((check) => check.required) ? "Release readiness cannot be confirmed" : latest.passed ? "Release checks passed" : "Release checks failed"}</h2>
          </div>
          <Verdict run={latest} />
        </div>
        <div className="mt-4 border-t border-line pt-4"><Where run={latest} /></div>
        <CheckList run={latest} />
        <p className="mt-5 border-t border-line pt-4 text-xs text-ink-3">Source: <code className="font-mono">results/gate/</code> · Run with <code className="font-mono">{COMMAND}</code>.</p>
      </Card>

      {older.length > 0 && (
        <Card as="section">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>Compare runs</Eyebrow>
              <h2 className="mt-1 text-lg font-semibold">Choose a saved run to compare</h2>
            </div>
            <form method="get" action="/app/safety/gate-report" className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs text-ink-2">
                <span>Compare latest with</span>
                <select name="compare" className={inputClass()} defaultValue={comparison?.ranAt ?? ""}>
                  <option value="" disabled>Select a saved run</option>
                  {older.slice(0, 30).map((run) => <option key={run.ranAt} value={run.ranAt}>{short(run.commit)} · {run.branch || "unknown branch"} · {new Date(run.ranAt).toLocaleString()}</option>)}
                </select>
              </label>
              <Button type="submit" variant="secondary" size="sm">Compare</Button>
            </form>
          </div>
          {invalidCompare && <p role="status" className="mt-3 text-sm text-quick">That saved comparison run is no longer available. Choose another run.</p>}
          {comparison && <div className="mt-5"><Comparison latest={latest} baseline={comparison} /></div>}
        </Card>
      )}

      {older.length === 0 && <p className="text-sm text-ink-2">Only one saved gate run is available, so there is no baseline to compare yet.</p>}
      <p className="text-xs text-ink-3">
        GitHub&apos;s Release gate runs the same required checks on pushes to main. The live scenario suite is shown in its own workspace because its agent runs are not deterministic gate checks.
      </p>
    </div>
  );
}

export default async function GateReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const requestedCompare = typeof params.compare === "string" ? params.compare : undefined;
  return (
    <SuiteGate>
      <PageHeader title="Release gate" description="See the latest required checks and release verdict, then compare it with a saved run from a known branch and commit." />
      <Suspense fallback={<SkeletonRows rows={6} className="mt-8" />}>
        <GateReport requestedCompare={requestedCompare} />
      </Suspense>
    </SuiteGate>
  );
}
