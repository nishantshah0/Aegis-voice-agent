import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Eyebrow, PageHeader, SkeletonRows, SkeletonTiles, StatTile } from "@/components/ui";
import { scriptedCallIds } from "../_parts/scripted";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { finishedCalls } from "@/app/console/review/calls";
import {
  judgeAgreement,
  latestLabels,
  readLabels,
} from "@/app/console/review/labels";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { ReviewBoard, type ReviewListItem } from "./ReviewBoard";
import { MARK, ReviewCard } from "./ReviewCard";

export const metadata = { title: "Call quality · Pharmacy · Aegis" };
const n = (v: number) => v.toLocaleString("en-US");

async function Body() {
  await connection(); // Live data: never prerender.
  // Session first: nothing from the record is read for a signed-out request.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="and label finished calls" />;
  const store = getStore();
  const [calls, labels, scripted] = await Promise.all([
    finishedCalls(store),
    readLabels(),
    scriptedCallIds(store),
  ]);
  const latest = latestLabels(labels);
  const list: ReviewListItem[] = calls.map((c) => {
    const forCall = latest.get(c.callId) ?? [];
    return {
      callId: c.callId,
      patient: c.patient,
      direction: c.direction,
      ...(c.endedAt ? { endedAt: c.endedAt } : {}),
      status: forCall.some((l) => l.marks.saveAsTest)
        ? "test"
        : forCall.length
          ? "labelled"
          : "unlabelled",
      blocked: c.blocked.length,
      lines: c.transcript.length,
      scripted: scripted.has(c.callId),
    };
  });
  const cards = Object.fromEntries(
    calls.map((c) => {
      const forCall = latest.get(c.callId) ?? [];
      const mine = forCall.find((l) => l.by.id === approver.id);
      return [
        c.callId,
        <ReviewCard
          key={c.callId}
          call={c}
          labels={forCall}
          scripted={scripted.has(c.callId)}
          {...(mine ? { mine } : {})}
        />,
      ];
    }),
  );

  return (
    <div className="mt-6">
      <ReviewBoard calls={list} cards={cards} />
      <details className="mt-6 rounded-card border border-line bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Saved tests and judge agreement</summary>
        <Suspense fallback={<p className="mt-3 text-xs text-ink-3">Saved test and judge details are loading.</p>}>
          <SecondaryReviewDetails calls={calls} list={list} labels={labels} />
        </Suspense>
      </details>
    </div>
  );
}

async function SecondaryReviewDetails({ calls, list, labels }: { calls: Awaited<ReturnType<typeof finishedCalls>>; list: ReviewListItem[]; labels: Awaited<ReturnType<typeof readLabels>> }) {
  const agreement = await judgeAgreement(labels);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs text-ink-3">Calls marked as saved test examples appear in the Saved as tests filter. They are not automatically run by the safety suite.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Finished calls" value={n(calls.length)} />
        <StatTile label="To label" value={n(list.filter((c) => c.status === "unlabelled").length)} tone="review" />
        <StatTile label="Labelled by people" value={n(list.filter((c) => c.status !== "unlabelled").length)} />
        <StatTile label="Saved as tests" value={n(list.filter((c) => c.status === "test").length)} />
      </div>
      <Card className="text-sm">
        <Eyebrow>AI judge</Eyebrow>
        {agreement && agreement.compared > 0 ? (
          <p className="mt-2">Agrees with people on <span className="font-semibold tabular-nums">{n(agreement.agreed)}</span> of <span className="font-semibold tabular-nums">{n(agreement.compared)}</span> answers.
            {agreement.disagreements.slice(0, 3).map((d, i) => <span key={i} className="mt-1 block text-ink-2"><span className="font-mono">{d.callId}</span>, {MARK[d.mark]}: judge says {d.judge ? "yes" : "no"}, people say {d.people ? "yes" : "no"}</span>)}
          </p>
        ) : <p className="mt-2 text-ink-2">{agreement ? "AI judge results are saved, but none are for a call people have labelled yet." : "No AI judge results saved under results/arena/judge/, so there is no agreement rate yet."}</p>}
      </Card>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Call quality"
        description="Finished calls from the record. Label each one: right outcome, anything promised wrongly, unsafe or advice-like, tone, and whether to keep it as a test."
        actions={<Live />}
      />
      <Suspense
        fallback={
          <div className="mt-8">
            <SkeletonTiles />
            <SkeletonRows className="mt-6" rows={4} />
          </div>
        }
      >
        <Body />
      </Suspense>
    </>
  );
}
