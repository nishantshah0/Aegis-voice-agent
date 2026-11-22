import { Bookings } from "./pharmacy/_parts/BookingsCard";
import { PhoneControl } from "@/app/present/OperatorControls";
import "@/app/present/page.css";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { daysLeft } from "@/app/api/_lib/outbound";
import { HISTORY_APPROVER } from "@/app/api/_lib/demo-history";
import { getStore } from "@/app/api/_lib/runtime";
import { WINDOW_DAYS } from "@/app/console/upcoming/upcoming";
import { Badge, ButtonLink, Card, LANE_TONE, PageHeader, SectionHeader, Skeleton, When, cn, linkClass } from "@/components/ui";
import { getApprover } from "@/lib/auth/session";
import type { QueueItem, Store } from "@/lib/contract";
import { findBrokenLink } from "@/lib/store/memory";
import { Live } from "./pharmacy/_parts/Live";
import { ScriptedTag } from "./pharmacy/_parts/HistoryNote";
import { routingReason, TODAY_LANE_LABEL } from "./pharmacy/today/ItemPanel";
import { PHARMACY_NAV, SAFETY_HOME } from "./_shell/nav";

export const metadata = { title: "Home · Aegis" };

const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5";
const ROW_LINK = cn(ROW, "transition-colors hover:bg-sunken/50 focus-visible:-outline-offset-2");
const CALLS = PHARMACY_NAV.calls.href;
const TODAY = PHARMACY_NAV.today.href;
const UPCOMING = PHARMACY_NAV.upcoming.href;

async function describeItem(store: Store, item: QueueItem) {
  const [patient, prescription] = await Promise.all([
    store.getPatient(item.patientId),
    item.rxId ? store.getPrescription(item.rxId) : undefined,
  ]);
  return {
    patient: patient ? (process.env.PATIENT_SIMULATION === "community-demo" && !process.env.DATABASE_URL ? patient.firstName + " " + patient.lastName : `${patient.firstName[0]}.${patient.lastName[0]}.`) : "Unknown patient",
    drug: prescription ? `${prescription.drug} ${prescription.strength}` : undefined,
  };
}

function ItemName({ kind, drug, patient }: { kind: QueueItem["kind"]; drug?: string; patient: string }) {
  return (
    <span className="min-w-0 text-ink">
      <span className="font-medium capitalize">{kind}</span>
      {drug && <> · {drug}</>}
      <span className="text-ink-3"> · {patient}</span>
    </span>
  );
}

async function Worklist({ store }: { store: Store }) {
  const queue = await store.queue();
  const waiting = queue.filter((i) => i.status === "open" && i.lane !== "automatic").sort((a, b) =>
    Number(a.lane !== "review") - Number(b.lane !== "review") || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const recent = queue.filter((i) => i.status !== "open" && i.lane !== "automatic").sort((a, b) =>
    Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt),
  );
  const [cards, top, decisions] = await Promise.all([
    waiting.length ? store.listCards() : [],
    Promise.all(waiting.slice(0, 5).map(async (item) => ({ item, ...(await describeItem(store, item)) }))),
    Promise.all(recent.slice(0, 3).map(async (item) => ({ item, ...(await describeItem(store, item)) }))),
  ]);

  return (
    <>
      <Card as="section" padded={false} aria-labelledby="home-worklist">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div>
            <h2 id="home-worklist" className="text-2xl leading-tight">Needs a pharmacist</h2>
            <p className="mt-1 text-sm text-ink-3">{waiting.length} waiting now</p>
          </div>
          <ButtonLink href={TODAY} size="lg">Open queue</ButtonLink>
        </div>
        {top.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {top.map(({ item, drug, patient }) => {
              const reason = routingReason({
                kind: item.kind,
                lane: item.lane,
                signals: item.signals,
                rules: item.ruleIds.map((id) => ({ id, wording: cards.find((card) => card.id === id)?.wording ?? `Routed by rule ${id}` })),
                questions: item.notes.filter((note) => note.kind === "question").map((note) => note.text),
              });
              return (
                <li key={item.id}>
                  <Link href={`${TODAY}?item=${encodeURIComponent(item.id)}`} className={ROW_LINK}>
                    <Badge dot tone={LANE_TONE[item.lane]}>{TODAY_LANE_LABEL[item.lane]}</Badge>
                    <ItemName kind={item.kind} drug={drug} patient={patient} />
                    <span className="ml-auto whitespace-nowrap text-xs text-ink-3">Waiting since <When iso={item.createdAt} /></span>
                    <span className="basis-full text-ink-2">{item.notes[0]?.text || reason}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-2 sm:px-5">
            No items are waiting. <Link className={linkClass} href={UPCOMING}>See upcoming refills</Link>
          </p>
        )}
      </Card>

      <Card as="section" padded={false} aria-label="Recently decided">
        <div className="px-4 pt-4 sm:px-5">
          <SectionHeader title="Recently decided" action={<ButtonLink href={`${TODAY}#recent`} variant="secondary" size="md">Recent in Today</ButtonLink>} />
        </div>
        {decisions.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {decisions.map(({ item, drug, patient }) => (
              <li key={item.id}>
                <Link href={`${TODAY}?item=${encodeURIComponent(item.id)}`} className={ROW_LINK}>
                  <Badge dot tone={item.status === "approved" ? "accent" : "stop"}>{item.status === "approved" ? "Approved" : "Declined"}</Badge>
                  <ItemName kind={item.kind} drug={drug} patient={patient} />
                  {item.decidedBy?.id === HISTORY_APPROVER.id && <ScriptedTag />}
                  <When iso={item.decidedAt} className="ml-auto text-xs text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-3 sm:px-5">No recent approvals or declines.</p>
        )}
      </Card>
    </>
  );
}

async function UpcomingRefills({ store }: { store: Store }) {
  const [now, patients] = await Promise.all([store.now(), store.listPatients()]);
  const byPatient = await Promise.all(patients.map(async (patient) => {
    const prescriptions = await store.getPrescriptions(patient.id);
    return prescriptions.map((rx) => ({
      id: rx.id,
      drug: `${rx.drug} ${rx.strength}`,
      initials: `${patient.firstName[0]}.${patient.lastName[0]}.`,
      left: daysLeft(rx, now),
    }));
  }));
  const rows = byPatient.flat().filter((row) => row.left <= WINDOW_DAYS).sort((a, b) => a.left - b.left).slice(0, 3);
  return (
    <Card as="section" padded={false} aria-label={PHARMACY_NAV.upcoming.label}>
      <div className="px-4 pt-4 sm:px-5">
        <SectionHeader title={PHARMACY_NAV.upcoming.label} action={<ButtonLink href={UPCOMING} variant="secondary" size="md">View upcoming refills</ButtonLink>} />
      </div>
      {rows.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map(({ id, drug, initials, left }) => (
            <li key={id} className={ROW}>
              <span className="font-medium text-ink">{drug}</span>
              <span className="text-ink-3">{initials}</span>
              <span className="ml-auto text-xs text-ink-3">{left < 0 ? `${-left} d overdue` : left === 0 ? "Due today" : `Due in ${left} d`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-3 sm:px-5">No refills due within {WINDOW_DAYS} days.</p>
      )}
    </Card>
  );
}

async function RecordIntegrity({ store }: { store: Store }) {
  const record = await store.listRecord();
  const brokenAt = findBrokenLink(record);
  if (brokenAt === null) return null;
  const entry = record.find((item) => item.seq === brokenAt);
  const href = entry?.callId ? `${CALLS}/${encodeURIComponent(entry.callId)}` : `${CALLS}#record-integrity`;
  return (
    <p className="text-sm text-stop">
      Record chain broken at entry {brokenAt}. <Link href={href} className="font-medium underline underline-offset-4">Inspect the record</Link>
    </p>
  );
}

async function Body() {
  await connection();
  if (!(await getApprover())) return null;
  const store = getStore();
  return (
    <div className="mt-6 grid gap-4">
      <Suspense fallback={<Skeleton className="h-48 rounded-card" />}>
        <Worklist store={store} />
      </Suspense>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-32 rounded-card" />}><Bookings store={store} /></Suspense>
        {process.env.AEGIS_PUBLIC_ORIGIN && <div className="workspace-controls"><PhoneControl /></div>}
      </div>
      <Suspense fallback={<Skeleton className="h-32 rounded-card" />}>
        <UpcomingRefills store={store} />
      </Suspense>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-1 text-sm">
        <Link href={SAFETY_HOME} className={linkClass}>Safety suite <span aria-hidden>↗</span></Link>
        <Suspense><RecordIntegrity store={store} /></Suspense>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <PageHeader title="Home" actions={<div className="flex flex-wrap items-center gap-2">
        <Live />
        {process.env.AEGIS_PUBLIC_ORIGIN && <>
          <ButtonLink href="/app/pharmacy/outreach#patients" size="sm" variant="ghost">Patient directory</ButtonLink>
          <ButtonLink href="/app/safety/business-tests" size="sm" variant="secondary">Business tests</ButtonLink>
          <ButtonLink href="/app/pharmacy/phone" size="sm">Open phone</ButtonLink>
        </>}
      </div>} />
      <Suspense fallback={<Skeleton className="mt-6 h-48 rounded-card" />}>
        <Body />
      </Suspense>
    </>
  );
}
