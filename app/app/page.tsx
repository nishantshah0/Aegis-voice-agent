import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Eyebrow, LaneBadge, PageHeader, RuleTag, StatTile, buttonClass, cn } from "@/components/ui";
import { getStore } from "@/app/api/_lib/runtime";
import { getApprover } from "@/lib/auth/session";
import { callsOverview } from "@/app/console/calls/calls";
import { itemDetail } from "@/app/console/today/detail";
import { readOvernight } from "@/app/console/overnight/results";
import { Icon } from "./_shell/Icon";
import { AREAS } from "./_shell/nav";

export const metadata = { title: "Overview · Aegis" };

const LANE_ORDER = { review: 0, quick_check: 1, automatic: 2 } as const;

// Everything here is read from the store, the record and results/. Nothing is typed in.
async function Pharmacy() {
  await connection();
  // The proxy already requires sign-in for /app; this is the second lock on the data itself.
  if (!(await getApprover())) return null;
  const store = getStore();
  const [overview, queue] = await Promise.all([callsOverview(store), store.queue()]);
  const open = queue
    .filter((q) => q.status === "open" && q.lane !== "automatic")
    .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const top = await Promise.all(open.slice(0, 4).map((q) => itemDetail(store, q)));
  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Today's calls">
        <StatTile label="Calls" value={overview.calls.length} hint={overview.chain.verified ? `Record: ${overview.chain.entries} entries, chain verified` : "Record chain not verified"} />
        <StatTile label="Review" value={overview.lanes.review} tone="review" />
        <StatTile label="Quick check" value={overview.lanes.quick_check} tone="quick" />
        <StatTile label="Automatic" value={overview.lanes.automatic} tone="accent" />
      </section>

      <Card className="mt-4" padded={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="font-semibold">Needs a pharmacist now</p>
            <p className="text-sm text-ink-3">{open.length === 0 ? "Nothing waiting." : `${open.length} waiting, Review first.`}</p>
          </div>
          <Link href="/app/pharmacy/today" className={buttonClass(open.length ? "primary" : "secondary", "sm")}>
            Open Today
          </Link>
        </div>
        {top.length > 0 && (
          <ul className="divide-y divide-line">
            {top.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <LaneBadge lane={d.lane} />
                <span className="font-semibold capitalize">{d.kind}</span>
                {d.drug && <span>{d.drug}</span>}
                <span className="text-ink-3">for {d.patient}</span>
                {d.rules.map((r) => (
                  <RuleTag key={r.id}>Rule {r.id}</RuleTag>
                ))}
                {d.sideEffects.length > 0 && <Badge tone="quick">side effect</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

async function Safety() {
  await connection();
  if (!(await getApprover())) return null;
  const o = await readOvernight();
  const hammer = o.hammer.state === "ok" ? o.hammer : null;
  const hijack = o.hijack.state === "ok" ? o.hijack : null;
  const suite = o.suite.state === "ok" ? o.suite : null;
  const broken = o.totals?.broken ?? null;
  return (
    <div className="theme-dark theme-safety rounded-card border border-line bg-canvas p-5 text-ink">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold">
          <Icon name="gate" className="size-[18px] text-accent" /> Safety suite
        </p>
        <Link href="/app/safety/overnight" className="text-sm text-ink-2 hover:text-ink">
          Details →
        </Link>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-ink-3">Rules broken</dt>
          <dd className={cn("mt-1 text-4xl font-semibold tabular-nums tracking-[-0.04em]", broken === 0 ? "text-accent" : broken ? "text-stop" : "text-ink-3")}>{broken ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Attacks caught</dt>
          <dd className="mt-1 text-4xl font-semibold tabular-nums tracking-[-0.04em]">{o.totals?.caught ?? "—"}</dd>
        </div>
      </dl>
      <ul className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm text-ink-2">
        <li className="grid grid-cols-[auto_1fr] gap-3">
          <span>Hammer</span>
          <span className="text-right text-ink-3">{hammer ? `${hammer.data.sequences.toLocaleString("en-US")} sequences · ${new Date(hammer.ranAt).toLocaleString()}` : "No run yet"}</span>
        </li>
        <li className="grid grid-cols-[auto_1fr] gap-3">
          <span>Hijack batch</span>
          <span className="text-right text-ink-3">{hijack ? `${hijack.data.caught} caught · ${new Date(hijack.ranAt).toLocaleString()}` : "No run yet"}</span>
        </li>
        <li className="grid grid-cols-[auto_1fr] gap-3">
          <span>Scenario suite</span>
          <span className="text-right text-ink-3">{suite ? `${suite.data.passed} of ${suite.data.scenarios} passed · ${new Date(suite.ranAt).toLocaleString()}` : "No run yet"}</span>
        </li>
      </ul>
    </div>
  );
}

function PhoneCard() {
  return (
    <Card>
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="phone" className="size-[18px] text-accent" /> Patient phone
      </p>
      <p className="mt-2 text-sm text-ink-2">The patient&apos;s side of the call, as its own device. Pair it to a patient from Today, then open it on that phone.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href="/phone" target="_blank" rel="noopener" className={buttonClass("primary", "sm")}>
          Open phone <span aria-hidden>↗</span>
        </a>
        <Link href="/app/pharmacy/today#pair" className={buttonClass("secondary", "sm")}>
          Pair a phone
        </Link>
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="What needs you now, and how the safety suite is holding." />
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <Eyebrow className="mb-3">Pharmacy calls</Eyebrow>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-sunken" />}>
            <Pharmacy />
          </Suspense>
        </div>
        <div className="space-y-4">
          <Eyebrow className="mb-3">Safety</Eyebrow>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-sunken" />}>
            <Safety />
          </Suspense>
          <PhoneCard />
        </div>
      </div>

      <Eyebrow className="mb-3 mt-10">Go to</Eyebrow>
      <div className="grid gap-3 md:grid-cols-2">
        {AREAS.map((a) => (
          <Card key={a.key} padded={false} className={cn(a.key === "safety" && "theme-dark theme-safety bg-canvas text-ink")}>
            <p className="px-5 pt-4 font-semibold">{a.label}</p>
            <ul className="grid grid-cols-1 gap-0.5 p-2 sm:grid-cols-2">
              {a.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-sunken">
                    <Icon name={item.icon} className="mt-0.5 size-[18px] shrink-0 text-accent" />
                    <span>
                      <span className="block text-sm font-medium text-ink">{item.label}</span>
                      <span className="block text-xs text-ink-3">{item.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
