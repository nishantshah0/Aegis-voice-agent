"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  chipClass,
  cn,
  inputClass,
  LaneBadge,
  RowNav,
  RuleTag,
  SectionHeader,
  StatTile,
  Table,
  TableEmpty,
  Td,
  Th,
  THead,
  Tr,
  type Lane,
} from "@/components/ui";
import type { OutreachData, OutreachRow } from "./data";
import { Calendar } from "./Calendar";
import {
  dayLabel,
  leftLabel,
  OUTCOME_LABEL,
  PATTERN_LABEL,
  pharmacyDate,
  shortDate,
} from "./format";
import { PatientPanel } from "./PatientPanel";

type SortKey =
  "name" | "drug" | "daysLeft" | "risk" | "nextCall" | "lane" | "lastOutcome";
type LaneFilter = "all" | Lane | "refused";

/** Within-days slider's top stop means "any". */
const ANY = 31;
/** "Usually skips": a fifth or more of past refills skipped or stopped. */
const SKIPS = 0.2;

const LANE_ORDER: Record<string, number> = {
  automatic: 0,
  quick_check: 1,
  review: 2,
  refused: 3,
};
const laneOf = (r: OutreachRow): Lane | "refused" =>
  "lane" in r.laneNow ? r.laneNow.lane : "refused";

function sortValue(r: OutreachRow, key: SortKey): string | number {
  switch (key) {
    case "name":
      return r.name;
    case "drug":
      return r.drug;
    case "daysLeft":
      return r.daysLeft;
    case "risk":
      return r.risk.score;
    case "nextCall":
      return r.nextCall ? Date.parse(r.nextCall.at) : Number.MAX_SAFE_INTEGER;
    case "lane":
      return LANE_ORDER[laneOf(r)];
    case "lastOutcome":
      return r.lastOutcome ? OUTCOME_LABEL[r.lastOutcome] : "~";
  }
}

function RiskMeter({ score, band }: OutreachRow["risk"]) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
        <span
          className={cn(
            "block h-full rounded-full",
            band === "high"
              ? "bg-stop"
              : band === "medium"
                ? "bg-quick"
                : "bg-auto",
          )}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </span>
      <span
        className={cn(
          "tabular-nums",
          band === "high" ? "font-semibold text-stop" : "text-ink-2",
        )}
      >
        {score}
      </span>
    </span>
  );
}

function SortTh({
  k,
  sort,
  onSort,
  children,
  className,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <Th
      className={className}
      aria-sort={
        active ? (sort.dir === 1 ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-ink",
          active && "text-ink",
        )}
      >
        {children}
        <span aria-hidden className="text-[10px]">
          {active ? (sort.dir === 1 ? "▲" : "▼") : ""}
        </span>
      </button>
    </Th>
  );
}

function Toggle({
  on,
  onChange,
  children,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={chipClass(on)}
    >
      {children}
    </button>
  );
}

export function OutreachView({ data }: { data: OutreachData }) {
  const { summary, rows, days } = data;
  const [q, setQ] = useState("");
  const [within, setWithin] = useState(ANY);
  const [skips, setSkips] = useState(false);
  const [controlled, setControlled] = useState(false);
  const [lane, setLane] = useState<LaneFilter>("all");
  const [day, setDay] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "nextCall",
    dir: 1,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);

  const t = summary.totals;
  const reviewPerDay = days.length
    ? days.reduce((s, d) => s + d.reviewLoad, 0) / days.length
    : 0;
  const peak = days.reduce(
    (a, d) => (d.reviewLoad > a.reviewLoad ? d : a),
    days[0],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const dayRx = day
      ? new Set(days.find((d) => d.date === day)?.rxIds ?? [])
      : null;
    const out = rows.filter(
      (r) =>
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.drug.toLowerCase().includes(needle) ||
          r.phone.includes(needle)) &&
        (within === ANY || r.daysLeft <= within) &&
        (!skips || r.skipRate >= SKIPS) &&
        (!controlled || r.controlled) &&
        (lane === "all" || laneOf(r) === lane) &&
        (!dayRx || dayRx.has(r.rxId)),
    );
    return out.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir;
    });
  }, [rows, days, q, within, skips, controlled, lane, day, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "risk" ? -1 : 1 },
    );
  const open = rows.find((r) => r.rxId === openId);

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-card border border-quick/25 bg-quick-soft/30 px-4 py-3">
        <div className="min-w-0 flex-1 text-[13px] text-ink-2">
          <p>
            {t.patients} made-up patients ({t.prescriptions} prescriptions),{" "}
            {summary.days} days from {dayLabel(pharmacyDate(summary.start))}.
            Every number here comes from saved run{" "}
            <code className="font-mono text-xs text-ink">
              results/sim/{summary.runId}/
            </code>
            , not from real patients.
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-medium text-ink">
              What&apos;s real code and what&apos;s the simulation&apos;s model
            </summary>
            <div className="mt-2 grid gap-3 text-xs md:grid-cols-2">
              <div>
                <p className="font-medium text-ink">
                  Real code, imported read only
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {summary.sources.real.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-ink">
                  Simulation&apos;s model (not in the product)
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {summary.sources.model.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Calls, next 7 days"
          value={t.callsNext7}
          hint={`${t.calls} over ${summary.days} days · simulated`}
        />
        <StatTile
          label="High-risk patients"
          value={t.atRisk}
          tone={t.atRisk ? "stop" : "neutral"}
          hint="Risk 55+ · simulation's model"
        />
        <StatTile
          label="Review lane per day"
          value={reviewPerDay.toFixed(1)}
          tone="review"
          hint={
            peak
              ? `Peak ${peak.reviewLoad} on ${shortDate(peak.date)} · simulated`
              : "simulated"
          }
        />
        <StatTile
          label="Days without medication"
          value={t.daysWithout}
          hint={`Summed over prescriptions · ${t.refills} refills · simulated`}
        />
      </div>

      <Card as="section">
        <SectionHeader
          title="Calls per day, by lane"
          description="Who the daily check would ring each day, stacked by the lane a refill on that call lands in."
          action={
            <span className="text-xs text-ink-3">
              {t.outcomes.answered} answered · {t.outcomes.voicemail} voicemail
              · {t.outcomes.no_answer} no answer ·{" "}
              {t.outcomes.asked_for_pharmacist} asked for a pharmacist
            </span>
          }
        />
        <div className="mt-4">
          <Calendar days={days} selected={day} onSelect={setDay} />
        </div>
        {Object.keys(t.heldByRule).length > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            Due but not rung, by the rule that held it:
            {Object.entries(t.heldByRule)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, n]) => (
                <span key={id} className="inline-flex items-center gap-1">
                  <RuleTag>{id}</RuleTag>
                  <span className="tabular-nums">{n}</span>
                </span>
              ))}
          </p>
        )}
      </Card>

      <section aria-labelledby="directory-heading">
        <h2 id="directory-heading" className="mb-3 text-xl font-semibold text-ink">Patient directory</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="patients"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, drug or phone"
            aria-label="Search patients"
            className={inputClass("w-full scroll-mt-16 sm:w-64")}
          />
          <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-sunken px-3 text-[13px] text-ink-2">
            Runs out within
            <input
              type="range"
              min={0}
              max={ANY}
              value={within}
              onChange={(e) => setWithin(Number(e.target.value))}
              aria-label="Runs out within days"
              className="w-28 accent-[var(--color-accent)]"
            />
            <span className="w-14 tabular-nums text-ink">
              {within === ANY ? "any" : `${within} days`}
            </span>
          </label>
          <Toggle on={skips} onChange={setSkips}>
            Usually skips
          </Toggle>
          <Toggle on={controlled} onChange={setControlled}>
            Controlled
          </Toggle>
          <select
            value={lane}
            onChange={(e) => setLane(e.target.value as LaneFilter)}
            aria-label="Lane"
            className={inputClass("text-ink-2")}
          >
            <option value="all">Any lane</option>
            <option value="automatic">Automatic</option>
            <option value="quick_check">Quick check</option>
            <option value="review">Review</option>
            <option value="refused">Refused</option>
          </select>
          {day && (
            <button
              type="button"
              onClick={() => setDay(null)}
              className="h-8 rounded-full bg-accent-soft px-3 text-[13px] font-medium text-accent-ink"
            >
              Called {shortDate(day)} ✕
            </button>
          )}
          <span className="ml-auto text-xs text-ink-3">
            {shown.length} of {rows.length} prescriptions · simulated
          </span>
        </div>

        <div className="mt-3">
          {shown.length === 0 ? (
            <TableEmpty>No simulated patients match these filters.</TableEmpty>
          ) : (
            <RowNav>
              <Table>
                <THead>
                  <tr>
                    <SortTh k="name" sort={sort} onSort={onSort}>
                      Patient · pattern
                    </SortTh>
                    <SortTh k="drug" sort={sort} onSort={onSort}>
                      Medication
                    </SortTh>
                    <SortTh k="daysLeft" sort={sort} onSort={onSort}>
                      Days left · runs out
                    </SortTh>
                    <SortTh k="risk" sort={sort} onSort={onSort}>
                      Risk
                    </SortTh>
                    <SortTh k="nextCall" sort={sort} onSort={onSort}>
                      Next call
                    </SortTh>
                    <SortTh k="lane" sort={sort} onSort={onSort}>
                      Lane today
                    </SortTh>
                    <SortTh k="lastOutcome" sort={sort} onSort={onSort}>
                      Last call
                    </SortTh>
                  </tr>
                </THead>
                <tbody>
                  {shown.slice(0, limit).map((r) => (
                    <Tr
                      key={r.rxId}
                      aria-selected={r.rxId === openId}
                      onClick={() => setOpenId(r.rxId)}
                    >
                      <Td className="whitespace-nowrap">
                        <span className="font-medium text-ink">{r.name}</span>
                        <span className="block text-xs text-ink-3">
                          {PATTERN_LABEL[r.pattern]}
                          {!r.optedIn && " · not opted in"}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.drug}
                        {r.controlled && (
                          <span className="block text-xs text-quick">
                            Controlled
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span
                          className={cn(
                            r.daysLeft < 0
                              ? "font-medium text-stop"
                              : r.daysLeft <= 3
                                ? "text-ink"
                                : "",
                          )}
                        >
                          {leftLabel(r.daysLeft)}
                        </span>
                        <span className="text-ink-3">
                          {" "}
                          · {shortDate(r.runOut)}
                        </span>
                      </Td>
                      <Td>
                        <RiskMeter {...r.risk} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.nextCall ? (
                          <>
                            {shortDate(pharmacyDate(r.nextCall.at))}
                            {r.nextCall.source === "early_reach" && (
                              <span className="ml-1 text-xs text-ink-3">
                                early
                              </span>
                            )}
                            {r.calls > 1 && (
                              <span className="ml-1 text-xs text-ink-3">
                                ×{r.calls}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-3">none</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {"lane" in r.laneNow ? (
                          <LaneBadge lane={r.laneNow.lane} />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Badge tone="stop">Refused</Badge>
                            {r.laneNow.refused.map((id) => (
                              <RuleTag key={id}>{id}</RuleTag>
                            ))}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.lastOutcome ? (
                          OUTCOME_LABEL[r.lastOutcome]
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </RowNav>
          )}
          {shown.length > limit && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((n) => n + 100)}
                className="text-sm font-medium text-accent hover:underline"
              >
                Show {Math.min(100, shown.length - limit)} more
              </button>
            </div>
          )}
        </div>
      </section>

      {open && <PatientPanel row={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
