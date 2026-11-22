import { replayTickets } from "@/app/api/_lib/replay-tickets";
import { relative } from "node:path";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { CallReplay } from "@/components/CallReplay";
import Link from "next/link";
import { Badge, Card, Eyebrow, When } from "@/components/ui";
import { readOvernight, type Gap, type Source } from "./results";
import { Replay } from "./Replay";

const fmt = (n: number) => n.toLocaleString("en-US");
const when = (iso: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "time not recorded");

/** A path short enough to read, with the full one on hover. */
function FilePath({ path }: { path: string }) {
  const rel = relative(process.cwd(), path);
  return (
    <code title={path} className="break-all font-mono text-xs text-ink-3">
      {rel.startsWith("..") ? path : rel}
    </code>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{fmt(value)}</dd>
    </div>
  );
}

/** One saved source: its numbers, or "no run yet" and the command that makes the file. */
function SourceCard<T>({ title, source, children }: { title: string; source: Source<T>; children: (data: T) => ReactNode }) {
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[22px] leading-tight">{title}</h2>
        {source.state === "ok" && <span className="text-xs text-ink-3">{when(source.ranAt)}</span>}
        {source.state === "error" && <Badge tone="stop">Can&apos;t read</Badge>}
      </div>
      {source.state === "ok" && (
        <>
          {children(source.data)}
          <FilePath path={source.path} />
        </>
      )}
      {source.state === "none" && (
        <div className="text-sm text-ink-2">
          <p className="font-medium text-ink">No run yet</p>
          <p className="mt-1">
            Made by: <code className="font-mono text-xs">{source.command}</code>
          </p>
          <p className="mt-1">
            Saved to: <FilePath path={source.where} />
          </p>
        </div>
      )}
      {source.state === "error" && (
        <div className="text-sm text-ink-2">
          <p>
            <FilePath path={source.path} />: {source.message}
          </p>
          <p className="mt-1">
            Run again: <code className="font-mono text-xs">{source.command}</code>
          </p>
        </div>
      )}
    </Card>
  );
}

function GapRow({ gap }: { gap: Gap }) {
  const source = { overnight: "Overnight attacker", suite: "Scenario suite", hijack: "Hijack batch", hammer: "Hammer" }[gap.source];
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm">{gap.scenario}</p>
          <Badge tone="neutral">{source}</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          {gap.detail || "The saved run reported a failure without additional detail."}
          {gap.ranAt && <> · <When iso={gap.ranAt} /></>}
        </p>
      </div>
      <span className="flex flex-wrap items-center gap-3">
        <Badge tone={gap.fix.status === "no fix yet" ? "stop" : "review"}>{gap.fix.status.replace(/_/g, " ")}</Badge>
        {gap.href ? <Link href={gap.href} className="text-xs font-medium underline underline-offset-2 hover:text-ink">Open evidence →</Link> : gap.source === "hammer" ? <a href="#saved-replay" className="text-xs font-medium underline underline-offset-2 hover:text-ink">See replay →</a> : null}
        {gap.fix.trail && (
          <a href={gap.fix.trail} className="text-xs underline">
            Open fix Trail →
          </a>
        )}
      </span>
    </li>
  );
}

// Every value is read from a saved result. Keep each run separate: scenario, hijack,
// overnight and hammer results have different scopes and may have different timestamps.
export async function Overnight() {
  await connection(); // Files change between runs: never prerender.
  const [approver, view] = await Promise.all([getApprover(), readOvernight()]);
  const { hammer, suite, hijack, overnight } = view;
  const hasRuns = [hammer, suite, hijack, overnight].some((source) => source.state === "ok");

  return (
    <div className="mt-8 flex flex-col gap-6">
      {approver && view.gaps.length > 0 && (
        <section aria-labelledby="overnight-needs-attention">
          <Eyebrow>Needs attention</Eyebrow>
          <h2 id="overnight-needs-attention" className="sr-only">Saved failures to review</h2>
          <Card className="mt-2 border-stop/40">
            <p className="mb-2 text-sm text-ink-2">Failures from saved runs. Each row names its source and run time.</p>
            <ul>{view.gaps.map((gap, i) => <GapRow key={`${gap.source}-${gap.scenario}-${i}`} gap={gap} />)}</ul>
          </Card>
        </section>
      )}

      <NightSummary source={overnight} />

      {approver && view.gaps.length === 0 && (
        <Card role="status" className="text-sm text-ink-2">
          {hasRuns ? "No gaps were reported by the available saved checks." : "No saved checks are available yet. Each source below shows where its next run will appear."}
        </Card>
      )}

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Eyebrow>Other saved checks</Eyebrow>
            <p className="mt-1 text-sm text-ink-2">Each result keeps its own test scope and timestamp.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
        <SourceCard title="Scenario suite" source={suite}>
          {(d) => (
            <dl className="grid grid-cols-3 gap-3">
              <div><dt className="text-xs text-ink-3">Run status</dt><dd className="mt-1"><Badge tone={d.completed ? "accent" : "review"} dot>{d.completed ? "Complete" : "Partial"}</Badge></dd></div>
              <Figure label="Scenarios passing 3 of 3" value={d.passed} />
              <Figure label="Scenarios" value={d.scenarios} />
              <Figure label="Calls" value={d.attempts} />
              <Figure label="Caught" value={d.caught} />
              <Figure label="Broken" value={d.broken} />
              <Figure label="Saved suite runs" value={d.batches} />
            </dl>
          )}
        </SourceCard>
        <SourceCard title="Hijack batch" source={hijack}>
          {(d) => (
            <dl className="grid grid-cols-3 gap-3">
              <Figure label="Attack calls" value={d.cards} />
              <Figure label="Caught" value={d.caught} />
              <Figure label="Broken" value={d.broken} />
              <Figure label="Saved batches" value={d.batches} />
            </dl>
          )}
        </SourceCard>
        <SourceCard title="The hammer" source={hammer}>
          {(d) => (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <Figure label="Sequences" value={d.sequences} />
                <Figure label="Presses" value={d.presses} />
                <Figure label="Invariant checks" value={d.checks} />
                <Figure label="Broken" value={d.broken} />
                <Figure label="Exhaustive depth" value={d.depth} />
                <Figure label="Invariants" value={d.invariants.names.length} />
              </dl>
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-2">
                  The invariants {d.invariants.from === "run" ? "this run checked" : "in scripts/hammer/invariants.ts (the saved file doesn't list them)"}
                </summary>
                <ul className="mt-2 list-disc pl-5 text-ink-2">
                  {d.invariants.names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </SourceCard>
        </div>
      </section>

      <section id="saved-replay">
        <Eyebrow>Replay one saved failure</Eyebrow>
        <Card className="mt-2">
          {approver ? view.replay ? (
            <>
              <p className="text-sm font-medium">{view.replay.title}</p>
              <p className="mb-3 text-xs text-ink-3">
                Source: <FilePath path={view.replay.path} /> · Re-run with <code className="font-mono">{view.replay.command}</code>.
              </p>
              {view.replay.call && <CallReplay key={view.replay.path} entries={view.replay.call.entries} tickets={replayTickets(view.replay.path, view.replay.call.entries)} verdict={view.replay.call.verdict} />}
              <Replay steps={view.replay.steps} />
            </>
          ) : (
            <p className="text-sm text-ink-2">{hasRuns ? "No saved failure is available to replay." : "No saved runs are available to replay yet."}</p>
          ) : (
            <p className="text-sm text-ink-2">
              <a href={AUTH_ROUTES.login} className="underline">Sign in</a> as a pharmacist or reviewer to open gaps and replay saved failures.
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}

function NightSummary({ source }: { source: Source<import("./results").NightView> }) {
  return (
    <section aria-labelledby="latest-overnight-run">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Eyebrow>Latest overnight attacker run</Eyebrow>
          <h2 id="latest-overnight-run" className="mt-1 text-[22px] leading-tight">Overnight safety check</h2>
          <p className="mt-1 text-sm text-ink-2">Synthetic attack calls · saved report · attacker model and run scope shown separately</p>
        </div>
        {source.state === "ok" && <span className="text-xs text-ink-3">Started <When iso={source.ranAt} /></span>}
        {source.state === "error" && <Badge tone="stop">Report unavailable</Badge>}
      </div>
      <Card className="mt-3">
        {source.state === "ok" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone={source.data.broken > 0 ? "stop" : "accent"} dot>{source.data.broken > 0 ? `${fmt(source.data.broken)} rules broken` : "No rules broken"}</Badge>
                <Badge tone={(source.data.failedCalls ?? 0) > 0 ? "review" : "neutral"}>{source.data.failedCalls === undefined ? "Failed calls not recorded" : `${fmt(source.data.failedCalls)} calls failed`}</Badge>
                <Badge tone={(source.data.badPlans ?? 0) > 0 ? "review" : "neutral"}>{source.data.badPlans === undefined ? "Plan errors not recorded" : `${fmt(source.data.badPlans)} plans unusable`}</Badge>
              </div>
              <span className="text-xs text-ink-3">Updated <When iso={source.data.updatedAt || source.ranAt} /></span>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Calls in this run" value={source.data.calls} />
              <Figure label="Blocked or routed" value={source.data.caught} />
              <Figure label="Gaps in this report" value={source.data.gaps.length} />
              <div><dt className="text-xs text-ink-3">Test scope</dt><dd className="mt-1 text-sm">{source.data.tactics.length ? `${source.data.tactics.length} tactics` : "Tactic count not recorded"}</dd></div>
            </dl>
            <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-ink-3">Agent model</dt><dd className="mt-1 break-words">{source.data.agentModel || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-ink-3">Attacker model</dt><dd className="mt-1 break-words">{source.data.attackerModel || source.data.attacker || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-ink-3">Run ID</dt><dd className="mt-1 break-all font-mono text-xs">{source.path.split("/").slice(-2, -1)[0]}</dd></div>
              <div><dt className="text-xs text-ink-3">Stopped because</dt><dd className="mt-1">{source.data.stoppedBecause || "Not recorded"}</dd></div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">Saved report: <FilePath path={source.path} /></p>
            {source.data.tactics.length > 0 && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium">Tactic breakdown · {source.data.tactics.length} in this run</summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left text-xs">
                    <thead className="text-ink-3"><tr><th className="py-2 pr-3 font-medium">Tactic</th><th className="py-2 px-3 text-right font-medium">Calls</th><th className="py-2 px-3 text-right font-medium">Caught</th><th className="py-2 px-3 text-right font-medium">Gaps</th><th className="py-2 pl-3 font-medium">Evidence</th></tr></thead>
                    <tbody>{source.data.tactics.map((tactic) => {
                      const gap = source.data.gaps.find((item) => item.scenario.endsWith(`_${tactic.id}`));
                      return <tr key={tactic.id} className="border-t border-line"><td className="py-2 pr-3"><span className="font-medium">{tactic.id.replace(/_/g, " ")}</span>{tactic.goal && <span className="mt-0.5 block text-ink-3">{tactic.goal}</span>}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(tactic.calls)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(tactic.caught)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(tactic.gaps)}</td><td className="py-2 pl-3">{gap?.href ? <Link href={gap.href} className="underline underline-offset-2">Open call →</Link> : tactic.gaps ? "See Needs attention" : "—"}</td></tr>;
                    })}</tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : source.state === "none" ? (
          <div className="text-sm text-ink-2">
            <p className="font-medium text-ink">No overnight run saved yet</p>
            <p className="mt-1">Run the overnight attacker to create a report and synthetic call evidence.</p>
            <p className="mt-2 text-xs text-ink-3">Expected report: <FilePath path={source.where} /></p>
          </div>
        ) : (
          <div role="status" className="text-sm text-ink-2">
            <p className="font-medium text-stop">The latest overnight report could not be loaded</p>
            <p className="mt-1">{source.message}</p>
            <p className="mt-2 text-xs text-ink-3">Source: <FilePath path={source.path} /> · Recover by running again: <code className="font-mono">{source.command}</code></p>
          </div>
        )}
      </Card>
    </section>
  );
}
