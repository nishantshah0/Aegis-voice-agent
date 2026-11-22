import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import {
  Badge,
  ButtonLink,
  Card,
  Columns,
  LaneBadge,
  PageHeader,
  RuleTag,
  SectionHeader,
  Skeleton,
  SkeletonTiles,
  Sparkline,
  StackedBar,
  StatTile,
  TableEmpty,
  When,
  cn,
  linkClass,
  type ChartTone,
} from "@/components/ui";
import { getStore } from "@/app/api/_lib/runtime";
import { getApprover } from "@/lib/auth/session";
import { callsOverview, type CallSummary } from "@/app/console/calls/calls";
import { itemDetail } from "@/app/console/today/detail";
import {
  readOvernight,
  type OvernightView,
} from "@/app/console/overnight/results";
import { loadOutreach, type OutreachDay } from "./pharmacy/outreach/data";
import { readLatestBatch, type BatchView } from "./safety/data";
import { Live } from "./pharmacy/_parts/Live";
import { HistoryNote, ScriptedTag } from "./pharmacy/_parts/HistoryNote";
import { scriptedCallIds } from "./pharmacy/_parts/scripted";

export const metadata = { title: "Home · Aegis" };

const ZONE = "America/Toronto";
const LANE_ORDER = { review: 0, quick_check: 1, automatic: 2 } as const;
const LANE_TONE = {
  automatic: "auto",
  quick_check: "quick",
  review: "review",
} as const satisfies Record<string, ChartTone>;
const n = (v: number) => v.toLocaleString("en-US");
const dayKey = (ms: number) =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: ZONE });
const dayName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Calls per day over the last 14 days, ending today (or at the newest call, if the demo clock runs ahead). */
function callsPerDay(calls: CallSummary[]) {
  const newest = Math.max(
    Date.now(),
    ...calls.map((c) => Date.parse(c.startedAt)).filter(Number.isFinite),
  );
  const keys = Array.from({ length: 14 }, (_, i) =>
    dayKey(newest - (13 - i) * 86_400_000),
  );
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const c of calls) {
    const k = dayKey(Date.parse(c.startedAt));
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((k) => ({ key: k, count: counts.get(k)! }));
}

function SafetyCard({
  o,
  batch,
}: {
  o: OvernightView;
  batch: BatchView | null;
}) {
  const hammer = o.hammer.state === "ok" ? o.hammer : null;
  const suite = o.suite.state === "ok" ? o.suite : null;
  const night = o.overnight.state === "ok" ? o.overnight : null;
  // The same sources the Safety suite's overview reads: the newest full hijack batch (not a stage pick), the suite, overnight and the hammer.
  const parts = [
    batch && { calls: batch.cards, caught: batch.caught, broken: batch.broken },
    suite && {
      calls: suite.data.attempts,
      caught: suite.data.caught,
      broken: suite.data.broken,
    },
    night && {
      calls: night.data.calls,
      caught: night.data.caught,
      broken: night.data.broken,
    },
  ].filter((p) => p !== null);
  const caught = parts.reduce((s, p) => s + p.caught, 0);
  const calls = parts.reduce((s, p) => s + p.calls, 0);
  const anyRun = parts.length > 0 || hammer !== null;
  const broken = anyRun
    ? parts.reduce((s, p) => s + p.broken, 0) + (hammer?.data.broken ?? 0)
    : null;
  const rows = [
    {
      label: "Hammer",
      at: hammer?.ranAt,
      text: hammer
        ? `${n(hammer.data.sequences)} sequences · ${n(hammer.data.broken)} broken`
        : "No run yet",
    },
    {
      label: "Hijack batch",
      at: batch?.ranAt,
      text: batch
        ? `${batch.cards} attack call${batch.cards === 1 ? "" : "s"} · ${batch.caught} caught`
        : "No run yet",
    },
    {
      label: "Scenario suite",
      at: suite?.ranAt,
      text: suite
        ? `${suite.data.passed} of ${suite.data.scenarios} passed`
        : "No run yet",
    },
    {
      label: "Overnight",
      at: night?.ranAt,
      text: night
        ? `${night.data.calls} calls · ${night.data.caught} caught`
        : "No run yet",
    },
  ];
  return (
    <Card padded={false} className="theme-safety flex flex-col">
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <div>
          <p className="text-xs font-medium text-ink-3">
            Rules broken, every run so far
          </p>
          <p
            className={cn(
              "mt-1.5 text-5xl font-semibold tabular-nums tracking-[-0.04em]",
              broken === 0
                ? "text-accent"
                : broken
                  ? "text-stop"
                  : "text-ink-3",
            )}
          >
            {broken ?? "—"}
          </p>
        </div>
        {broken === 0 && (
          <Badge tone="accent" dot>
            Held every time
          </Badge>
        )}
      </div>
      <p className="px-5 pt-2 text-[13px] text-ink-2">
        {anyRun
          ? `${n(hammer?.data.presses ?? 0)} hostile presses and ${n(calls)} attack call${calls === 1 ? "" : "s"}, all through the 12 buttons and the speech guard.`
          : "No safety run saved yet."}
      </p>
      <div className="px-5 pt-4">
        <StackedBar
          segments={[
            { label: "Attacks caught", value: caught, tone: "accent" },
            { label: "Broke a rule", value: broken ?? 0, tone: "stop" },
          ]}
        />
      </div>
      <ul className="mt-4 divide-y divide-line border-t border-line text-[13px]">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-3 px-5 py-2.5"
          >
            <span className="text-ink">{r.label}</span>
            <span className="flex min-w-0 items-center gap-2 text-right text-ink-3">
              <span className="truncate">{r.text}</span>
              {r.at && (
                <>
                  <span aria-hidden>·</span>
                  <When iso={r.at} />
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/app/safety"
        className="mt-auto border-t border-line px-5 py-3 text-[13px] font-medium text-accent hover:bg-sunken/50"
      >
        Open the Safety suite →
      </Link>
    </Card>
  );
}

function Forecast({
  days,
  runId,
  callsNext7,
  reviewLoad,
}: {
  days: OutreachDay[];
  runId: string;
  callsNext7: number;
  reviewLoad: number;
}) {
  return (
    <Card>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            Outreach, next {days.length} days
            <Badge tone="quick" dot>
              Simulated
            </Badge>
          </span>
        }
        description={`Calls per day by the lane a refill would land in · run ${runId}`}
        action={
          <Link href="/app/pharmacy/outreach" className={linkClass}>
            Open Outreach →
          </Link>
        }
      />
      <Columns
        className="mt-4"
        height={112}
        columns={days.map((d, i) => ({
          key: d.date,
          title: `${dayName(d.date)}: ${d.calls} calls (${d.callsByLane.automatic} automatic, ${d.callsByLane.quick_check} quick check, ${d.callsByLane.review} review). Simulated.`,
          label: i === 0 || i % 7 === 0 ? dayName(d.date) : "",
          segments: [
            { value: d.callsByLane.automatic, tone: "auto" },
            { value: d.callsByLane.quick_check, tone: "quick" },
            { value: d.callsByLane.review, tone: "review" },
          ],
        }))}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-2">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {(["automatic", "quick_check", "review"] as const).map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-[3px]",
                  l === "automatic"
                    ? "bg-auto"
                    : l === "quick_check"
                      ? "bg-quick"
                      : "bg-review",
                )}
              />
              {l === "automatic"
                ? "Automatic"
                : l === "quick_check"
                  ? "Quick check"
                  : "Review"}
            </span>
          ))}
        </span>
        <span className="tabular-nums text-ink-3">
          <span className="font-medium text-ink">{n(callsNext7)}</span> calls in
          the next 7 days ·{" "}
          <span className="font-medium text-ink">
            {(reviewLoad / Math.max(1, days.length)).toFixed(1)}
          </span>{" "}
          for a pharmacist a day
        </span>
      </div>
    </Card>
  );
}

function RecentCalls({ calls, scripted }: { calls: CallSummary[]; scripted: Set<string> }) {
  const recent = [...calls]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, 6);
  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <SectionHeader
          className="mb-0"
          title="Recent calls"
          description={<HistoryNote count={calls.filter((c) => scripted.has(c.callId)).length} className="mt-1.5" />}
          action={
            <Link href="/app/pharmacy/calls" className={linkClass}>
              All calls →
            </Link>
          }
        />
      </div>
      {recent.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[13px] text-ink-3">
          No calls yet. Run the daily check from the Demo menu to ring
          today&apos;s patients.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {recent.map((c) => (
            <li key={c.callId}>
              <Link
                href={`/app/pharmacy/calls/${encodeURIComponent(c.callId)}`}
                className="flex items-center gap-3 px-5 py-2.5 text-[13px] transition-colors hover:bg-sunken/50"
              >
                <span className="font-mono text-xs text-ink-3">{c.callId}</span>
                {scripted.has(c.callId) && <ScriptedTag />}
                <span className="min-w-0 flex-1 truncate text-ink">
                  {c.direction === "outbound" ? "Outbound" : "Inbound"}
                  {c.patient && (
                    <span className="text-ink-2"> · {c.patient}</span>
                  )}
                </span>
                {c.blocked.length > 0 && (
                  <Badge tone="stop">{c.blocked.length} blocked</Badge>
                )}
                <When iso={c.startedAt} className="text-xs text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Everything here is read from the store, the record and results/. Nothing is typed in.
async function Body() {
  await connection();
  // The proxy already requires sign-in for /app; this is the second lock on the data itself.
  if (!(await getApprover())) return null;
  const store = getStore();
  const [overview, queue, safety, batch, outreach, scripted] = await Promise.all([
    callsOverview(store),
    store.queue(),
    readOvernight(),
    readLatestBatch(),
    loadOutreach().catch(() => null),
    scriptedCallIds(store),
  ]);
  const open = queue
    .filter((q) => q.status === "open" && q.lane !== "automatic")
    .sort(
      (a, b) =>
        LANE_ORDER[a.lane] - LANE_ORDER[b.lane] ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  const top = await Promise.all(
    open
      .slice(0, 5)
      .map(async (q) => ({ d: await itemDetail(store, q), at: q.createdAt })),
  );
  const perDay = callsPerDay(overview.calls);
  const blocked = overview.calls.reduce((s, c) => s + c.blocked.length, 0);
  const agentLines = overview.calls.reduce(
    (s, c) => s + c.transcript.filter((l) => l.who === "agent").length,
    0,
  );
  const routed =
    overview.lanes.automatic +
    overview.lanes.quick_check +
    overview.lanes.review;

  return (
    <>
      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card padded={false}>
            <div className="flex items-start justify-between gap-4 p-5 pb-4">
              <div>
                <h2 className="text-[22px] leading-tight text-ink">
                  Needs a pharmacist
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {open.length
                    ? `${open.length} waiting, Review first.`
                    : "Calls the rules send to a pharmacist land here, with the reason attached."}
                </p>
              </div>
              <ButtonLink
                href="/app/pharmacy/today"
                size="sm"
                variant={open.length ? "primary" : "secondary"}
              >
                {open.length ? `Review ${open.length}` : "Open Today"}
              </ButtonLink>
            </div>
            {top.length === 0 ? (
              <div className="border-t border-line px-5 py-4">
                <TableEmpty className="border-0 bg-transparent p-0">
                  Nothing waiting. The herd&apos;s all set.
                </TableEmpty>
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {top.map(({ d, at }) => (
                  <li key={d.id}>
                    <Link
                      href={`/app/pharmacy/today?item=${encodeURIComponent(d.id)}`}
                      className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px] transition-colors hover:bg-sunken/50"
                    >
                      <LaneBadge lane={d.lane} />
                      <span className="font-medium capitalize text-ink">
                        {d.kind}
                      </span>
                      {d.drug && <span className="text-ink">{d.drug}</span>}
                      <span className="text-ink-3">for {d.patient}</span>
                      {d.rules.map((r) => (
                        <RuleTag key={r.id}>Rule {r.id}</RuleTag>
                      ))}
                      {d.sideEffects.length > 0 && (
                        <Badge tone="quick">side effect</Badge>
                      )}
                      <When iso={at} className="ml-auto text-xs text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section
            aria-label="The phone line"
            className="grid grid-cols-2 gap-4"
          >
            <StatTile
              label="Calls, last 14 days"
              value={n(perDay.reduce((s, d) => s + d.count, 0))}
              chart={
                <Sparkline
                  label="Calls per day, last 14 days"
                  values={perDay.map((d) => d.count)}
                  titles={perDay.map(
                    (d) =>
                      `${dayName(d.key)}: ${d.count} call${d.count === 1 ? "" : "s"}`,
                  )}
                />
              }
              hint={`${dayName(perDay[0].key)} to ${dayName(perDay[perDay.length - 1].key)}`}
            />
            <StatTile
              label="Where refills landed"
              value={n(routed)}
              chart={
                <StackedBar
                  segments={(
                    ["automatic", "quick_check", "review"] as const
                  ).map((l) => ({
                    label:
                      l === "automatic"
                        ? "Auto"
                        : l === "quick_check"
                          ? "Quick"
                          : "Review",
                    value: overview.lanes[l],
                    tone: LANE_TONE[l],
                  }))}
                />
              }
            />
            <StatTile
              label="Lines blocked by the speech guard"
              value={n(blocked)}
              tone={blocked ? "stop" : "neutral"}
              hint={`Of ${n(agentLines)} agent line${agentLines === 1 ? "" : "s"} checked before it was said`}
            />
            <StatTile
              label="Record entries"
              value={n(overview.chain.entries)}
              hint={
                overview.chain.verified ? (
                  <Badge tone="accent" dot>
                    Hash chain verified
                  </Badge>
                ) : (
                  <Badge tone="stop" dot>
                    Chain broken at entry {overview.chain.brokenAt}
                  </Badge>
                )
              }
            />
          </section>
        </div>
        <SafetyCard o={safety} batch={batch} />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {outreach?.state === "ok" ? (
          <Forecast
            days={outreach.data.days}
            runId={outreach.data.summary.runId}
            callsNext7={outreach.data.summary.totals.callsNext7}
            reviewLoad={outreach.data.summary.totals.reviewLoad}
          />
        ) : (
          <Card>
            <SectionHeader title="Outreach forecast" />
            <TableEmpty>
              No simulation run saved yet. Make one from Outreach.
            </TableEmpty>
          </Card>
        )}
        <RecentCalls calls={overview.calls} scripted={scripted} />
      </div>
    </>
  );
}

function BodySkeleton() {
  return (
    <div aria-busy aria-label="Loading">
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
      <SkeletonTiles className="mt-4" />
      <Skeleton className="mt-4 h-64 rounded-card" />
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Home"
        description="What needs a pharmacist, how the phone line is doing, and how the lock is holding."
        actions={<div className="flex flex-wrap items-center gap-2">
          <Live />
          {process.env.AEGIS_PUBLIC_ORIGIN && <>
            <ButtonLink href="/app/pharmacy/outreach#patients" size="sm" variant="ghost">Patient directory</ButtonLink>
            <ButtonLink href="/app/safety/business-tests" size="sm" variant="secondary">Business tests</ButtonLink>
            <ButtonLink href="/app/pharmacy/phone" size="sm">Open phone</ButtonLink>
          </>}
        </div>}
      />
      <Suspense fallback={<BodySkeleton />}>
        <Body />
      </Suspense>
    </>
  );
}
