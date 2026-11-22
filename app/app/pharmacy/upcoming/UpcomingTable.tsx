"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Eyebrow, LaneBadge, RuleTag, Table, TableEmpty, Td, Th, THead, TimelineStrip, Tr, cn } from "@/components/ui";
import type { Upcoming, UpcomingRow } from "@/app/console/upcoming/upcoming";
import { CallNow } from "@/app/console/upcoming/CallNow";
import { SlideOver } from "../_parts/SlideOver";
import { label } from "../_parts/format";
import { FILTER_LABEL, filterUpcoming, matches, nextUp, type UpcomingFilter } from "./filter";

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" });
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const reminder = (r: string) => (/^\d{4}-/.test(r) ? short(r) : r);

function DaysLeft({ left }: { left: number }) {
  if (left < 0) return <Badge tone="stop">{-left} days late</Badge>;
  if (left === 0) return <Badge tone="review">runs out today</Badge>;
  return <span className="tabular-nums">{left} days</span>;
}

function Preview({ row }: { row: UpcomingRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {row.preview.kind === "refused" ? (
        <Badge tone="stop" dot>
          Refused
        </Badge>
      ) : (
        <LaneBadge lane={row.preview.lane} />
      )}
      {row.preview.ruleIds.map((id) => (
        <RuleTag key={id}>{id}</RuleTag>
      ))}
    </span>
  );
}

function Fact({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm last:border-0">
      <dt className="text-ink-3">{name}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/** Upcoming refills: filter, search, pick a day on the strip, open a row for the detail. */
export function UpcomingTable({ data, canCall }: { data: Upcoming; canCall: boolean }) {
  const [filter, setFilter] = useState<UpcomingFilter>("all");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();
  const rows = useMemo(() => filterUpcoming(data.rows, { filter, query, ...(day ? { day } : {}) }), [data.rows, filter, query, day]);
  const next = useMemo(() => nextUp(data.rows), [data.rows]);
  const open = data.rows.find((r) => r.rxId === openId);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card data-testid="upcoming-strip">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Run-outs in the next 14 days</Eyebrow>
            {day && (
              <button type="button" onClick={() => setDay(undefined)} className="text-xs text-accent hover:underline">
                Show every day
              </button>
            )}
          </div>
          <div className="relative mt-3">
            <TimelineStrip days={data.days.map((d, i) => ({ label: i === 0 ? "Today" : weekday(d.date), count: d.count, title: `${d.count} on ${d.date}` }))} />
            <div className="absolute inset-0 grid grid-flow-col auto-cols-fr gap-1.5">
              {data.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={day === d.date}
                  aria-label={`${d.count} running out ${short(d.date)}`}
                  onClick={() => setDay(day === d.date ? undefined : d.date)}
                  className={cn("rounded-md transition-colors hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-accent", day === d.date && "ring-2 ring-accent")}
                />
              ))}
            </div>
          </div>
        </Card>
        <Card>
          <Eyebrow>Next up for the daily check</Eyebrow>
          {next.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">Nobody to ring today.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2 text-sm">
              {next.slice(0, 5).map((r, i) => (
                <li key={r.rxId}>
                  <button type="button" onClick={() => setOpenId(r.rxId)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-sunken">
                    <span>
                      <span className="mr-2 tabular-nums text-ink-3">{i + 1}</span>
                      <span className="font-medium">{r.initials}</span> <span className="text-ink-2">{r.drug}</span>
                    </span>
                    <DaysLeft left={r.daysLeft} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search initials or medicine"
          aria-label="Search upcoming refills"
          className="h-9 w-64 rounded-full border border-line-strong bg-surface px-4 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        {(Object.keys(FILTER_LABEL) as UpcomingFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-8 rounded-full border px-3.5 text-[13px] transition-colors",
              filter === f ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
            )}
          >
            {FILTER_LABEL[f]} <span className="tabular-nums opacity-70">{data.rows.filter((r) => matches(r, f)).length}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <TableEmpty>{data.rows.length === 0 ? "No refills due in the next 14 days." : "No refills match."}</TableEmpty>
        ) : (
          <Table data-testid="upcoming-table">
            <THead>
              <tr>
                <Th>Patient</Th>
                <Th>Medication</Th>
                <Th>Runs out</Th>
                <Th>Would land in</Th>
                <Th>Last call</Th>
                <Th>Next reminder</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((row) => (
                <Tr
                  key={row.rxId}
                  tabIndex={0}
                  onClick={() => setOpenId(row.rxId)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(row.rxId))}
                  className="cursor-pointer focus-visible:bg-sunken focus-visible:outline-none"
                  aria-label={`${row.initials}, ${row.drug}: open detail`}
                >
                  <Td className="font-medium text-ink">{row.initials}</Td>
                  <Td>
                    {row.drug} {row.controlled && <Badge tone="review">controlled</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <DaysLeft left={row.daysLeft} /> <span className="text-ink-3">· {short(row.runOut)}</span>
                  </Td>
                  <Td>
                    <Preview row={row} />
                  </Td>
                  <Td>{row.lastCall ? `${row.lastCall.direction}, ${label(row.lastCall.state)}` : "none"}</Td>
                  <Td>{reminder(row.nextReminder)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-3">
        &ldquo;Would land in&rdquo; runs today&apos;s rule cards as a preview: nothing is pressed or recorded. Open a row for the detail
        {canCall ? " and Call now, which goes through rule 7 like the daily check." : "."}
      </p>

      <SlideOver open={Boolean(open)} onClose={() => setOpenId(undefined)} title={open ? `${open.initials} · ${open.drug}` : ""}>
        {open && (
          <div className="flex flex-col gap-5">
            <dl>
              <Fact name="Runs out">
                <DaysLeft left={open.daysLeft} /> <span className="text-ink-3">· {short(open.runOut)}</span>
              </Fact>
              <Fact name="Controlled">{open.controlled ? "Yes" : "No"}</Fact>
              <Fact name="A refill today would land in">
                <Preview row={open} />
              </Fact>
              <Fact name="Next reminder">{reminder(open.nextReminder)}</Fact>
              <Fact name="Last call">
                {open.lastCall ? (
                  <Link href={`/app/pharmacy/calls/${encodeURIComponent(open.lastCall.callId)}`} className="text-accent underline-offset-4 hover:underline">
                    {open.lastCall.callId}, {open.lastCall.direction}, {label(open.lastCall.state)}
                  </Link>
                ) : (
                  "none"
                )}
              </Fact>
            </dl>
            <p className="text-xs text-ink-3">The lane is a read-only preview of today&apos;s rule cards. Nothing was pressed or written to the record.</p>
            {canCall ? (
              <div className="border-t border-line pt-4">
                <CallNow patientId={open.patientId} rxId={open.rxId} />
              </div>
            ) : (
              <p className="text-sm text-ink-3">Only a pharmacist can start a call.</p>
            )}
          </div>
        )}
      </SlideOver>
    </>
  );
}
