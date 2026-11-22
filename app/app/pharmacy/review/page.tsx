import { PHARMACY_NAV } from "../../_shell/nav";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Eyebrow, PageHeader, SkeletonRows, SkeletonTiles, StatTile } from "@/components/ui";
import { HistoryNote } from "../_parts/HistoryNote";
import { historyCallIds } from "@/app/api/_lib/demo-history";
import { getApprover } from "@/lib/auth/session";
import { getStore } from "@/app/api/_lib/runtime";
import { describeCall } from "@/app/console/review/calls";
import {
  judgeAgreement,
  latestLabels,
  readLabels,
} from "@/app/console/review/labels";
import { Live } from "../_parts/Live";
import { SignedOut } from "../_parts/SignedOut";
import { ReviewBoard, type ReviewListItem } from "./ReviewBoard";
import { MARK } from "./ReviewCard";

export const metadata = { title: `${PHARMACY_NAV.quality.label} · Pharmacy · Aegis` };
const n = (v: number) => v.toLocaleString("en-US");

async function Body() {
  await connection(); // Live data: never prerender.
  // Session first: nothing from the record is read for a signed-out request.
  const approver = await getApprover();
  if (!approver) return <SignedOut what="and label finished calls" />;
  const store = getStore();
  const [record, queue, labels] = await Promise.all([store.listRecord(), store.queue(), readLabels()]);
  const byCall = Map.groupBy(record, (entry) => entry.callId);
  const ids = [...byCall.keys()].filter((id) => id !== undefined);
  const [storedCalls, patients, agreement] = await Promise.all([
    store.getCalls(ids), store.listPatients(), judgeAgreement(labels),
  ]);
  const calls = storedCalls.filter((call) => call.state === "ended")
    .sort((a, b) => byCall.get(b.id)![0].seq - byCall.get(a.id)![0].seq);
  const byPatient = new Map(patients.map((patient) => [patient.id, patient]));
  const scripted = historyCallIds(record);
  const latest = latestLabels(labels);
  const list: ReviewListItem[] = calls.map((call) => {
    const entries = byCall.get(call.id) ?? [];
    const forCall = latest.get(call.id) ?? [];
    const patientId = call.lockedPatientId ?? call.targetPatientId;
    const patient = patientId ? byPatient.get(patientId) : undefined;
    const blocked = entries.filter((entry) => entry.kind === "line_blocked").length;
    return {
      callId: call.id,
      patient: patient ? `${patient.firstName[0]}.${patient.lastName[0]}.` : "Unknown caller",
      direction: call.direction,
      ...(call.endedAt ? { endedAt: call.endedAt } : {}),
      status: forCall.some((label) => label.marks.saveAsTest) ? "test" : forCall.length ? "labelled" : "unlabelled",
      blocked,
      lines: blocked + entries.filter((entry) => entry.kind === "line_spoken" || entry.kind === "caller_line").length,
    };
  });
  const first = list.find((row) => row.status === "unlabelled") ?? list[0];
  const call = first ? await describeCall(store, first.callId, byCall.get(first.callId) ?? [],
    queue.filter((item) => item.callId === first.callId)) : null;
  const initialLabels = call ? latest.get(call.callId) ?? [] : [];
  const initial = call ? { call, labels: initialLabels, mine: initialLabels.find((label) => label.by.id === approver.id) } : null;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <HistoryNote count={calls.filter((c) => scripted.has(c.id)).length} className="w-fit" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Finished calls" value={n(calls.length)} />
        <StatTile
          label="To label"
          value={n(list.filter((c) => c.status === "unlabelled").length)}
          tone="review"
        />
        <StatTile
          label="Labelled by people"
          value={n(list.filter((c) => c.status !== "unlabelled").length)}
        />
        <StatTile
          label="Saved as tests"
          value={n(list.filter((c) => c.status === "test").length)}
        />
      </div>
      <Card className="text-sm">
        <Eyebrow>AI judge</Eyebrow>
        {agreement && agreement.compared > 0 ? (
          <p className="mt-2">
            Agrees with people on{" "}
            <span className="font-semibold tabular-nums">
              {n(agreement.agreed)}
            </span>{" "}
            of{" "}
            <span className="font-semibold tabular-nums">
              {n(agreement.compared)}
            </span>{" "}
            answers.
            {agreement.disagreements.slice(0, 3).map((d, i) => (
              <span key={i} className="mt-1 block text-ink-2">
                <span className="font-mono">{d.callId}</span>, {MARK[d.mark]}:
                judge says {d.judge ? "yes" : "no"}, people say{" "}
                {d.people ? "yes" : "no"}
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-2 text-ink-2">
            {agreement
              ? "AI judge results are saved, but none are for a call people have labelled yet."
              : "No AI judge results saved under results/arena/judge/, so there's no agreement rate yet."}
          </p>
        )}
      </Card>
      <ReviewBoard calls={list} initial={initial} />
    </div>
  );
}

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title={PHARMACY_NAV.quality.label}
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
