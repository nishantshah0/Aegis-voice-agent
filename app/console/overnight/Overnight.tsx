import { replayTickets } from "@/app/api/_lib/replay-tickets";
import { relative } from "node:path";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { CallReplay } from "@/components/CallReplay";
import { Badge, Card, Eyebrow, StatTile } from "@/components/ui";
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
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <div>
        <p className="font-mono text-sm">{gap.scenario}</p>
        <p className="text-xs text-ink-3">
          {gap.source}
          {gap.detail ? ` · ${gap.detail}` : ""}
        </p>
      </div>
      <span className="flex items-center gap-2">
        <Badge tone={gap.fix.status === "no fix yet" ? "stop" : "review"}>{gap.fix.status.replace(/_/g, " ")}</Badge>
        {gap.fix.trail && (
          <a href={gap.fix.trail} className="text-xs underline">
            Trail
          </a>
        )}
      </span>
    </li>
  );
}

// The Overnight safety tab (SPEC Part 2; demo step 5). Every number is read from a file
// a real run saved under results/. Signed out: totals only. Gaps and replays need a
// pharmacist or reviewer signed in, like Today.
export async function Overnight() {
  await connection(); // Files change between runs: never prerender.
  const [approver, view] = await Promise.all([getApprover(), readOvernight()]);
  const { hammer, suite, hijack, overnight, totals } = view;

  return (
    <div className="mt-8 flex flex-col gap-8">
      {totals ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Calls made" value={fmt(totals.calls)} hint="Scenario suite, hijack batch and overnight attacker" />
          <StatTile label="Forbidden requests caught" value={fmt(totals.caught)} tone="review" />
          <StatTile label="Rules broken" value={fmt(totals.broken)} tone={totals.broken === 0 ? "accent" : "stop"} hint="Hammer included" />
        </div>
      ) : (
        <Card>
          <p className="text-sm text-ink-2">Nothing saved under results/ yet. Each card below names the command that saves its file.</p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <SourceCard title="Overnight attacker" source={overnight}>
          {(d) => (
            <dl className="grid grid-cols-3 gap-3">
              <Figure label="Calls" value={d.calls} />
              <Figure label="Caught" value={d.caught} />
              <Figure label="Gaps found" value={d.gaps.length} />
            </dl>
          )}
        </SourceCard>
        <SourceCard title="Scenario suite" source={suite}>
          {(d) => (
            <dl className="grid grid-cols-3 gap-3">
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

      {approver ? (
        <>
          <section>
            <Eyebrow>Gaps found</Eyebrow>
            <Card className="mt-2">
              {view.gaps.length ? (
                <ul>
                  {view.gaps.map((gap, i) => (
                    <GapRow key={`${gap.source}-${gap.scenario}-${i}`} gap={gap} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">
                  {totals ? "No gaps in the saved runs. Every saved check passed." : "No saved runs to look for gaps in."}
                </p>
              )}
            </Card>
          </section>
          <section>
            <Eyebrow>A saved failure, replayed</Eyebrow>
            <Card className="mt-2">
              {view.replay ? (
                <>
                  <p className="text-sm font-medium">{view.replay.title}</p>
                  <p className="mb-3 text-xs text-ink-3">
                    From <FilePath path={view.replay.path} />. Run it again with <code className="font-mono">{view.replay.command}</code>.
                  </p>
                  {view.replay.call && <CallReplay key={view.replay.path} entries={view.replay.call.entries} tickets={replayTickets(view.replay.path, view.replay.call.entries)} verdict={view.replay.call.verdict} />}
                  <Replay steps={view.replay.steps} />
                </>
              ) : (
                <p className="text-sm text-ink-2">No saved failure to replay: no saved run broke a check.</p>
              )}
            </Card>
          </section>
        </>
      ) : (
        <p className="text-sm text-ink-2">
          <a href={AUTH_ROUTES.login} className="underline">
            Sign in
          </a>{" "}
          as a pharmacist or reviewer to see the gaps and replay a saved failure.
        </p>
      )}
    </div>
  );
}
