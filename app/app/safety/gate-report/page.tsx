import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, PageHeader, SkeletonRows, When } from "@/components/ui";
import { gateDir, readGateRuns, type GateRun } from "@/scripts/gate";
import { SuiteGate } from "../SignedIn";

export const metadata = { title: "Release gate · Safety suite · Aegis" };

// AUDIT #9 (Trail #78): is main releasable? Read only from the runs `node scripts/gate.ts`
// saved to results/gate/ (the same files GET /api/gate/latest serves). Nothing is typed in.

const COMMAND = "node scripts/gate.ts";
const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);
const short = (sha: string) => sha.slice(0, 7) || "unknown";

function Verdict({ run }: { run: GateRun }) {
  return run.passed ? (
    <Badge tone="accent" dot>
      Releasable
    </Badge>
  ) : (
    <Badge tone="stop" dot>
      Not releasable
    </Badge>
  );
}

function Where({ run }: { run: GateRun }) {
  return (
    <span className="text-sm text-ink-2">
      <code className="font-mono text-xs text-ink">{short(run.commit)}</code> on <span className="text-ink">{run.branch || "unknown branch"}</span> · <When iso={run.ranAt} /> · took {secs(run.ms)}
      {run.dirty && <span className="text-quick"> · with uncommitted changes</span>}
    </span>
  );
}

function Checks({ run }: { run: GateRun }) {
  return (
    <ul className="mt-4 divide-y divide-line">
      {run.checks.map((c) => (
        <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
          <span className="flex items-center gap-2">
            <span aria-hidden className={c.passed ? "text-accent" : c.required ? "text-stop" : "text-ink-3"}>
              {c.passed ? "✓" : c.required ? "✕" : "–"}
            </span>
            <span className="font-medium text-ink">{c.name}</span>
            {!c.required && <span className="text-xs text-ink-3">for information, doesn&apos;t decide the gate</span>}
          </span>
          <span className="text-sm text-ink-2">
            {c.detail}
            {c.ms > 0 && <span className="text-ink-3"> · {secs(c.ms)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

async function GateReport() {
  await connection(); // the gate script writes these files: never prerender.
  const runs = readGateRuns(gateDir());
  if (!runs.length) {
    return (
      <Card className="mt-8 text-sm text-ink-2">
        <p className="font-medium text-ink">No release gate run saved yet</p>
        <p className="mt-1">
          Run <code className="font-mono text-xs text-ink">{COMMAND}</code>. It runs typecheck, lint, tests, the hammers and the build, and saves the result to{" "}
          <code className="font-mono text-xs">results/gate/</code>.
        </p>
      </Card>
    );
  }
  const [latest, before, ...older] = runs;
  const changed = before ? latest.checks.filter((c) => before.checks.find((b) => b.name === c.name)?.passed !== c.passed) : [];
  return (
    <div className="mt-8 space-y-6">
      <Card as="section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>Latest run</Eyebrow>
            <Verdict run={latest} />
          </div>
          <Where run={latest} />
        </div>
        <Checks run={latest} />
      </Card>

      {before && (
        <Card as="section">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>The run before</Eyebrow>
              <Verdict run={before} />
            </div>
            <Where run={before} />
          </div>
          <p className="mt-3 text-sm text-ink-2">
            {changed.length === 0
              ? "Every check came out the same as in the latest run."
              : `Changed since: ${changed.map((c) => `${c.name} ${c.passed ? "now passes" : "now fails"}`).join(", ")}.`}
          </p>
        </Card>
      )}

      {older.length > 0 && (
        <section>
          <Eyebrow>Earlier runs</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-sm">
            {older.slice(0, 10).map((r) => (
              <li key={r.ranAt} className="flex flex-wrap items-center gap-3">
                <Verdict run={r} />
                <Where run={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-3">
        Run it again with <code className="font-mono">{COMMAND}</code>. GitHub&apos;s Release gate runs the same checks on every push to main. The scenario suite is listed for information:
        runs of the live agent aren&apos;t deterministic, so they don&apos;t decide the gate.
      </p>
    </div>
  );
}

export default function GateReportPage() {
  return (
    <SuiteGate>
      <PageHeader title="Release gate" description="Is main releasable? One command runs typecheck, lint, tests, the hammers and the build; this page shows its saved result and the run before." />
      <Suspense fallback={<SkeletonRows rows={6} className="mt-8" />}>
        <GateReport />
      </Suspense>
    </SuiteGate>
  );
}
