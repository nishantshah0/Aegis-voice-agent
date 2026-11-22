import { replayTickets } from "@/app/api/_lib/replay-tickets";
import { readFile } from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, LaneBadge, PageHeader, RuleTag, Skeleton, SkeletonRows, Table, Td, Th, THead, Tr } from "@/components/ui";
import { CallReplay } from "@/components/CallReplay";
import { getApprover } from "@/lib/auth/session";
import { USAGE_LOG } from "@/lib/agent/usage";
import { getDriver, getStore } from "@/app/api/_lib/runtime";
import type { TimingSource } from "@/app/console/calls/calls";
import { DecideBar } from "../../_parts/Decide";
import { Live } from "../../_parts/Live";
import { SignedOut } from "../../_parts/SignedOut";
import { auditTimestamp, label, seconds } from "../../_parts/format";
import { ScriptedTag } from "../../_parts/HistoryNote";
import { scriptedCallIds } from "../../_parts/scripted";
import { SIGNAL_LABEL } from "../../today/ItemPanel";
import { OUTCOME_LABEL, OUTCOME_TONE } from "../rows";
import { callDetail, type CallDetail, type DecisionView } from "./detail";
import { Timeline } from "./Timeline";

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
              <Link href={`/app/safety/rules#rule-${encodeURIComponent(r.id)}`} className="shrink-0 hover:underline"><RuleTag>Rule {r.id}</RuleTag></Link> {r.wording}
            </li>
          ))}
        </ul>
      )}
      <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">Routing evidence</summary>
        {d.routeEvents.length ? (
          <ul className="mt-2 space-y-2">
            {d.routeEvents.map((event) => (
              <li key={event.seq}>
                <Link href={`#event-${event.seq}`} className="font-medium text-accent underline-offset-4 hover:underline">Open matching record event #{event.seq}</Link>
                <time dateTime={event.at} className="ml-2 text-xs text-ink-3">{auditTimestamp(event.at)}</time>
                <div className="mt-1 flex flex-wrap gap-1">{event.ruleIds.map((id) => <Link key={id} href={`/app/safety/rules#rule-${encodeURIComponent(id)}`} className="hover:underline"><RuleTag>{id}</RuleTag></Link>)}</div>
                <p className="mt-1 text-xs text-ink-3">{event.hasContext ? "Saved rule inputs are available in the expanded event." : "No rule-input snapshot was saved with this event."}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-3">No button event in the record carries this item&apos;s routing rule and lane.</p>
        )}
        <p className="mt-2 text-xs text-ink-3">The record does not attach a specific transcript line to this routing event; the chronological transcript is shown in the call timeline.</p>
      </details>
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
              <p className="text-ink-2"><Badge tone="review" dot>Waiting for a pharmacist</Badge></p>
              <p className="text-xs text-ink-3">Queued <time dateTime={d.createdAt}>{auditTimestamp(d.createdAt)}</time></p>
              {canDecide && <DecideBar id={d.id} className="mt-3" />}
            </>
          )
        ) : (
          <div className="space-y-1">
            <Badge tone={d.status === "approved" ? "accent" : "stop"} dot>{d.status === "approved" ? "Approved" : "Declined"}</Badge>
            <p className="font-medium text-ink">{d.decidedBy ?? "Reviewer not recorded"}</p>
            <time dateTime={d.decidedAt} className="block text-xs text-ink-3">{auditTimestamp(d.decidedAt)}</time>
            <p className="text-ink-2">{d.decisionNote ? `“${d.decisionNote}”` : "No decision note recorded."}</p>
          </div>
        )}
        {d.order && <p className="mt-2 text-xs text-ink-3">Order {d.order.id}: {label(d.order.state)}</p>}
      </div>
    </Card>
  );
}

function CallEvidence({ call, canDecide }: { call: CallDetail; canDecide: boolean }) {
  const cost = call.usage.reduce((s, u) => s + u.costUsd, 0);
  return (
    <div className="flex flex-col gap-6">
      <section>
        <Eyebrow>Decision history</Eyebrow>
        <div className="mt-2 flex flex-col gap-3">
          {call.items.length === 0 ? <Card className="text-sm text-ink-3">No refill or other action from this call entered a pharmacist queue.</Card> : call.items.map((d) => <Decision key={d.id} d={d} canDecide={canDecide} />)}
        </div>
      </section>
      <details className="rounded-card border border-line bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <div className="mt-3 flex flex-col gap-5">
          <section>
            <Eyebrow>Turn timing (server side)</Eyebrow>
            {call.timing.length === 0 ? <p className="mt-1 text-xs text-ink-3">No timing from this server process.</p> : <Table><THead><tr><Th>Turn</Th><Th>First model text</Th><Th>First guarded line</Th></tr></THead><tbody>{call.timing.map((t, i) => <Tr key={i}><Td>{i + 1}</Td><Td>{ms(t.firstModelTextMs)}</Td><Td>{ms(t.firstGuardedMs)}</Td></Tr>)}</tbody></Table>}
          </section>
          <section data-testid="call-usage">
            <Eyebrow>Model usage and cost</Eyebrow>
            {call.usage.length === 0 ? <p className="mt-1 text-xs text-ink-3">No usage row logged for this call id in {USAGE_LOG}.</p> : <p className="mt-1 text-xs text-ink-2">{n(call.usage.length)} turns · {n(call.usage.reduce((s, u) => s + u.modelCalls, 0))} model calls · {n(call.usage.reduce((s, u) => s + u.inputTokens, 0))} input · {n(call.usage.reduce((s, u) => s + u.outputTokens, 0))} output · ${cost.toFixed(4)}. Model: {[...new Set(call.usage.map((u) => u.model))].join(", ")}.</p>}
          </section>
          <section data-testid="call-chain">
            <Eyebrow>Record chain</Eyebrow>
            <p className="mt-1 text-xs text-ink-2">Every entry&apos;s hash checked against the one before it, across {n(call.chain.entries)} entries{call.chain.first !== undefined ? `; this call holds #${call.chain.first}–#${call.chain.last}` : ""}.</p>
            {call.chain.headHash && <p className="mt-1 break-all font-mono text-[11px] text-ink-3">head {call.chain.headHash}</p>}
            <a href={`/api/calls/${encodeURIComponent(call.callId)}/record`} className="mt-2 inline-block text-xs font-medium text-accent underline-offset-4 hover:underline">Export this call&apos;s record (JSON)</a>
          </section>
        </div>
      </details>
    </div>
  );
}

async function Body({ params, searchParams }: { params: PageProps<"/app/pharmacy/calls/[id]">["params"]; searchParams: PageProps<"/app/pharmacy/calls/[id]">["searchParams"] }) {
  await connection(); // Live data: never prerender.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="this call" />;
  const search = await searchParams;
  const listParams = new URLSearchParams();
  for (const key of ["q", "lane", "outcome"] as const) {
    const value = search[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) listParams.set(key, first);
  }
  const returnHref = `/app/pharmacy/calls${listParams.size ? `?${listParams}` : ""}`;
  const { id } = await params;
  const store = getStore();
  const driver = getDriver();
  const timings = "turnTimings" in driver ? (driver as TimingSource) : undefined;
  const usageLog = await readFile(USAGE_LOG, "utf8").catch(() => "");
  const call = await callDetail(store, decodeURIComponent(id), { ...(timings ? { driver: timings } : {}), usageLog });
  if (!call) notFound();
  const [scripted, cards] = await Promise.all([scriptedCallIds(store), store.listCards()]);
  const isScripted = scripted.has(call.callId);
  const ruleWording = new Map(cards.map((c) => [c.id, c.wording]));
  const length = seconds(call.startedAt, call.endedAt);

  return (
    <>
      <Link href={returnHref} className="text-[13px] text-ink-3 transition-colors hover:text-ink">
        ← All calls
      </Link>
      <div className="mt-3" />
      <PageHeader
        title={
          <span className="font-mono">Call {call.callId}</span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{call.patient ?? "Unknown caller"}</span>· {call.direction}
            {length ? ` · ${length} s` : ""}
            <Badge tone={call.state === "ended" ? "neutral" : "accent"} dot={call.state !== "ended"}>
              {label(call.state)}
            </Badge>
            <Badge tone={call.verified ? "accent" : "neutral"}>{call.verified ? "verified" : "not verified"}</Badge>
          </span>
        }
        actions={<Live callId={call.callId} />}
      />
      <Card className="mt-6 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><Eyebrow>Outcome</Eyebrow><div className="mt-1"><Badge tone={OUTCOME_TONE[call.outcome]}>{OUTCOME_LABEL[call.outcome]}</Badge></div></div>
        <div><Eyebrow>Source</Eyebrow><div className="mt-1">{isScripted ? <ScriptedTag /> : <span>Call record</span>}</div></div>
        <div><Eyebrow>Started</Eyebrow><time className="mt-1 block text-ink-2" dateTime={call.startedAt}>{auditTimestamp(call.startedAt)}</time></div>
        <div><Eyebrow>Record integrity</Eyebrow><div className="mt-1"><Badge tone={call.chain.verified ? "accent" : "stop"} dot>{call.chain.verified ? "Verified" : `Broken at entry ${call.chain.brokenAt}`}</Badge></div></div>
        <div className="sm:col-span-2 xl:col-span-4">
          <Eyebrow>Routing reason</Eyebrow>
          {call.items.length ? (
            <ul className="mt-2 space-y-2">
              {call.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start gap-2">
                  <LaneBadge lane={item.lane} />
                  <span className="font-medium capitalize">{item.kind}{item.drug ? ` · ${item.drug}` : ""}</span>
                  <span className="text-ink-2">{item.rules.length ? item.rules.map((r) => ruleWording.get(r.id) ?? r.wording).join(" · ") : item.signals.length ? item.signals.map((s) => SIGNAL_LABEL[s] ?? s).join(" · ") : "The record contains no rule or signal wording for this route."}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-ink-2">No queue item was created for this call, so there is no pharmacist routing reason to show.</p>}
        </div>
      </Card>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section>
          <Eyebrow>Chronological timeline and transcript</Eyebrow>
          <div className="mt-3 flex flex-col gap-4">
            <CallReplay key={call.callId} entries={call.timeline} tickets={replayTickets(call.callId + call.startedAt, call.timeline)} recordingUrl={call.hasRecording ? `/api/calls/${encodeURIComponent(call.callId)}/recording` : undefined} />
            <Timeline events={call.timeline} />
          </div>
        </section>
        <CallEvidence call={call} canDecide={approver.role === "pharmacist"} />
      </div>
    </>
  );
}

export default function CallPage(props: PageProps<"/app/pharmacy/calls/[id]">) {
  return (
    <>
      <Suspense
        fallback={
          <div>
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-2 h-4 w-96" />
            <Skeleton className="mt-8 h-32 rounded-card" />
            <SkeletonRows className="mt-8" />
          </div>
        }
      >
        <Body params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
