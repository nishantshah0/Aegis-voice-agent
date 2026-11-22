import { replayTickets } from "@/app/api/_lib/replay-tickets";
import { readFile } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, LaneBadge, PageHeader, RuleTag, Skeleton, SkeletonRows, SkeletonTiles, StatTile, Table, Td, Th, THead, Tr, When } from "@/components/ui";
import { CallReplay } from "@/components/CallReplay";
import { getApprover } from "@/lib/auth/session";
import { USAGE_LOG } from "@/lib/agent/usage";
import { median } from "@/lib/voice/timing";
import { getDriver, getStore } from "@/app/api/_lib/runtime";
import type { TimingSource } from "@/app/console/calls/calls";
import { DecideBar } from "../../_parts/Decide";
import { Live } from "../../_parts/Live";
import { SignedOut } from "../../_parts/SignedOut";
import { label, seconds } from "../../_parts/format";
import { SIGNAL_LABEL } from "../../today/ItemPanel";
import { OUTCOME_LABEL, OUTCOME_TONE } from "../rows";
import { callDetail, type CallDetail, type DecisionView } from "./detail";
import { Timeline } from "./Timeline";
import { ClearLock } from "../../_parts/ClearLock";

export const metadata = { title: "Call · Pharmacy · Aegis" };

// Cache Components needs one param to prerender the page's shell. A placeholder no call
// ever has, so every real call id is rendered on request.
export async function generateStaticParams() {
  return [{ id: "__shell__" }];
}

const ms = (v?: number) => (v === undefined ? "–" : `${Math.round(v).toLocaleString("en-CA")} ms`);
const n = (v: number) => v.toLocaleString("en-CA");

function Decision({ d, canDecide }: { d: DecisionView; canDecide: boolean }) {
  return (
    <Card className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <LaneBadge lane={d.lane} />
        <strong className="font-semibold capitalize">{d.kind}</strong>
        {d.drug && <span>{d.drug}</span>}
      </div>
      {d.rules.length > 0 && (
        <ul className="space-y-1 text-ink-2">
          {d.rules.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <RuleTag>Rule {r.id}</RuleTag> {r.wording}
            </li>
          ))}
        </ul>
      )}
      {d.signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.signals.map((s) => (
            <Badge key={s}>{SIGNAL_LABEL[s] ?? s}</Badge>
          ))}
        </div>
      )}
      {d.sideEffects.length > 0 && (
        <div>
          <Eyebrow>Side effects reported</Eyebrow>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {d.sideEffects.map((s) => (
              <li key={s}>&ldquo;{s}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
      {d.questions.length > 0 && (
        <div>
          <Eyebrow>Questions</Eyebrow>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-line pt-3">
        {d.status === "open" ? (
          d.lane === "automatic" ? (
            <p className="text-ink-3">Went through on its own.</p>
          ) : (
            <>
              <p className="text-ink-2">
                <Badge tone="review" dot>
                  Waiting for a pharmacist
                </Badge>{" "}
                <span className="text-ink-3">
                  since <When iso={d.createdAt} />
                </span>
              </p>
              {canDecide && <DecideBar id={d.id} className="mt-3" />}
            </>
          )
        ) : (
          <p>
            <Badge tone={d.status === "approved" ? "accent" : "stop"} dot>
              {d.status === "approved" ? "Approved" : "Declined"}
            </Badge>{" "}
            by <span className="font-medium">{d.decidedBy ?? "unknown"}</span> <When iso={d.decidedAt} className="text-ink-3" />
            {d.decisionNote && <span className="mt-1 block text-ink-2">&ldquo;{d.decisionNote}&rdquo;</span>}
          </p>
        )}
        {d.order && <p className="mt-2 text-xs text-ink-3">Order {d.order.id}: {label(d.order.state)}</p>}
      </div>
    </Card>
  );
}

function Side({ call, canDecide }: { call: CallDetail; canDecide: boolean }) {
  const cost = call.usage.reduce((s, u) => s + u.costUsd, 0);
  return (
    <div className="flex flex-col gap-6">
      <section>
        <Eyebrow>Sent to the pharmacist</Eyebrow>
        <div className="mt-2 flex flex-col gap-3">
          {call.items.length === 0 ? <Card className="text-sm text-ink-3">Nothing from this call went to the queue.</Card> : call.items.map((d) => <Decision key={d.id} d={d} canDecide={canDecide} />)}
        </div>
      </section>

      <section>
        <Eyebrow>Turn timing (server side)</Eyebrow>
        {call.timing.length === 0 ? (
          <Card className="mt-2 text-sm text-ink-3">No timing: this call didn&apos;t run on the real agent in this server process.</Card>
        ) : (
          <div className="mt-2">
            <Table>
              <THead>
                <tr>
                  <Th>Turn</Th>
                  <Th>First model text</Th>
                  <Th>First guarded line</Th>
                </tr>
              </THead>
              <tbody>
                {call.timing.map((t, i) => (
                  <Tr key={i}>
                    <Td>{i + 1}</Td>
                    <Td>{ms(t.firstModelTextMs)}</Td>
                    <Td>{ms(t.firstGuardedMs)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      <section data-testid="call-usage">
        <Eyebrow>Tokens for this call</Eyebrow>
        {call.usage.length === 0 ? (
          <Card className="mt-2 text-sm text-ink-3">No model usage logged for this call id in {USAGE_LOG}.</Card>
        ) : (
          <Card className="mt-2 text-sm">
            <p className="tabular-nums">
              {n(call.usage.length)} turns · {n(call.usage.reduce((s, u) => s + u.modelCalls, 0))} model calls · {n(call.usage.reduce((s, u) => s + u.inputTokens, 0))} in ·{" "}
              {n(call.usage.reduce((s, u) => s + u.outputTokens, 0))} out · ${cost.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              The newest {call.usage.length} turns logged under this id, one per caller line on this call (ids restart after each demo reset). Model: {[...new Set(call.usage.map((u) => u.model))].join(", ")}.
            </p>
          </Card>
        )}
      </section>

      <section data-testid="call-chain">
        <Eyebrow>Record chain</Eyebrow>
        <Card className="mt-2 text-sm">
          {call.chain.verified ? (
            <Badge tone="accent" dot>
              Record chain verified
            </Badge>
          ) : (
            <Badge tone="stop" dot>
              Record chain broken at entry {call.chain.brokenAt}
            </Badge>
          )}
          <p className="mt-2 text-ink-2">
            Every entry&apos;s hash checked against the one before it, across all {n(call.chain.entries)} entries.
            {call.chain.first !== undefined && ` This call holds entries #${call.chain.first} to #${call.chain.last}.`}
          </p>
          {call.chain.headHash && <p className="mt-1 font-mono text-xs break-all text-ink-3">head {call.chain.headHash}</p>}
          <a href={`/api/calls/${encodeURIComponent(call.callId)}/record`} className="mt-3 inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline">
            Export this call&apos;s record (JSON)
          </a>
        </Card>
      </section>
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/app/pharmacy/calls/[id]">["params"] }) {
  await connection(); // Live data: never prerender.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="this call" />;
  const { id } = await params;
  const driver = getDriver();
  const timings = "turnTimings" in driver ? (driver as TimingSource) : undefined;
  const usageLog = await readFile(USAGE_LOG, "utf8").catch(() => "");
  const call = await callDetail(getStore(), decodeURIComponent(id), { ...(timings ? { driver: timings } : {}), usageLog });
  if (!call) notFound();
  const count = (g: string) => call.timeline.filter((e) => e.group === g).length;
  const firstGuarded = median(call.timing.flatMap((t) => (t.firstGuardedMs === undefined ? [] : [t.firstGuardedMs])));
  const length = seconds(call.startedAt, call.endedAt);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{call.callId}</span>
            <Badge tone={OUTCOME_TONE[call.outcome]}>{OUTCOME_LABEL[call.outcome]}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{call.patient ?? "Unknown caller"}</span>· {call.direction} · started <When iso={call.startedAt} />
            {length ? ` · ${length} s` : ""}
            <Badge tone={call.state === "ended" ? "neutral" : "accent"} dot={call.state !== "ended"}>
              {label(call.state)}
            </Badge>
            <Badge tone={call.verified ? "accent" : "neutral"}>{call.verified ? "verified" : "not verified"}</Badge>
          </span>
        }
        actions={<Live callId={call.callId} />}
      />
      {call.lockedUntil && call.patientId && (
        <div className="mt-4">
          <ClearLock patientId={call.patientId} who={call.patient ?? "this patient"} lockedUntil={call.lockedUntil} canClear={approver.role === "pharmacist"} />
        </div>
      )}
      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Lines said" value={count("speech")} />
        <StatTile label="Buttons pressed" value={count("button")} />
        <StatTile label="Lines blocked" value={count("blocked")} tone={count("blocked") ? "stop" : "neutral"} />
        <StatTile label="Record entries" value={call.timeline.length} />
        <StatTile label="First guarded line" value={ms(firstGuarded)} hint={call.timing.length ? `median of ${call.timing.length} turns` : "no timing"} />
      </section>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <Eyebrow>What happened, from the record</Eyebrow>
          <div className="mt-3">
            <CallReplay key={call.callId} entries={call.timeline} tickets={replayTickets(call.callId + call.startedAt, call.timeline)} recordingUrl={call.hasRecording ? `/api/calls/${encodeURIComponent(call.callId)}/recording` : undefined} />
            <Timeline events={call.timeline} />
          </div>
        </section>
        <Side call={call} canDecide={approver.role === "pharmacist"} />
      </div>
    </>
  );
}

export default function CallPage(props: PageProps<"/app/pharmacy/calls/[id]">) {
  return (
    <>
      <Link href="/app/pharmacy/calls" className="text-[13px] text-ink-3 transition-colors hover:text-ink">
        ← All calls
      </Link>
      <div className="mt-3" />
      <Suspense
        fallback={
          <div>
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-2 h-4 w-96" />
            <SkeletonTiles className="mt-8 md:grid-cols-5" count={5} />
            <SkeletonRows className="mt-8" />
          </div>
        }
      >
        <Body params={props.params} />
      </Suspense>
    </>
  );
}
