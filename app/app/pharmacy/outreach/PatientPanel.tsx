"use client";

import { useEffect } from "react";
import { Badge, cn, Eyebrow, LaneBadge, RuleTag } from "@/components/ui";
import type { FillEvent } from "@/lib/seed/population";
import type { OutreachRow } from "./data";
import { clock, dayLabel, FILL_LABEL, leftLabel, longDate, OUTCOME_LABEL, PATTERN_LABEL, pharmacyDate, shortDate, TIME_LABEL } from "./format";

const FILL_TONE: Record<FillEvent["status"], string> = { on_time: "bg-auto", late: "bg-quick", skipped: "bg-stop", stopped: "bg-ink-3" };

/** One square per refill that was due, oldest first. */
export function HistoryStrip({ events, label }: { events: FillEvent[]; label: string }) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <ol className="mt-1.5 flex flex-wrap gap-1" aria-label={label}>
        {events.map((e, i) => {
          const text = `${FILL_LABEL[e.status]}${e.status === "late" ? ` by ${e.daysLate} days` : ""}: due ${longDate(e.dueAt)}${e.filledAt ? `, filled ${longDate(e.filledAt)}` : ""}`;
          return (
            <li key={i} title={text} aria-label={text} className={cn("h-6 w-4 rounded-sm", FILL_TONE[e.status])}>
              {e.status === "late" && e.daysLate >= 10 && <span className="sr-only">very late</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/** The slide-over for one patient's prescription: history, past calls, and what the sim predicts. */
export function PatientPanel({ row, onClose }: { row: OutreachRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const counts = { on_time: 0, late: 0, skipped: 0, stopped: 0 };
  for (const e of row.history) counts[e.status]++;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${row.name}, simulated patient`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface shadow-card">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="quick">Simulated patient</Badge>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{row.name}</h2>
              <p className="text-sm text-ink-2">
                {row.drug}
                {row.controlled && " · controlled"} · {row.phone}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
              Close
            </button>
          </div>
        </header>

        <div className="space-y-7 px-6 py-6">
          {row.prescription && (
            <section>
              <Eyebrow>Synthetic prescription record</Eyebrow>
              <dl className="mt-2 divide-y divide-line">
                <Row k="Demo date of birth">{row.dob}</Row>
                <Row k="Prescription number">{row.prescription.number}</Row>
                <Row k="Last fill">{longDate(row.prescription.lastFill)}</Row>
                <Row k="Days supplied">{row.prescription.days}</Row>
                {row.prescription.quantity && <Row k="Quantity">{row.prescription.quantity} {row.prescription.unit}</Row>}
                <Row k="Insurance pays">{row.prescription.plan.startsWith("$") ? row.prescription.plan : "No saved quote"}</Row>
                <Row k="Patient pays">{row.prescription.patient.startsWith("$") ? row.prescription.patient : "No saved quote"}</Row>
              </dl>
            </section>
          )}
          <section>
            <Eyebrow>Why and when the line calls</Eyebrow>
            {row.nextCall ? (
              <div className="mt-2 rounded-xl border border-line bg-sunken/60 p-4">
                <p className="text-[15px] font-medium text-ink">
                  {dayLabel(pharmacyDate(row.nextCall.at))} at {clock(row.nextCall.at)}
                  {row.nextCall.source === "early_reach" && (
                    <Badge tone="neutral" className="ml-2 align-middle">
                      Early reach
                    </Badge>
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-2">{row.nextCall.why}</p>
                <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
                  A refill asked for on that call lands in <LaneBadge lane={row.nextCall.lane} />
                </p>
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-2">No call in the window. {row.noCallWhy}.</p>
            )}
          </section>

          <section>
            <Eyebrow>Right now (day one of the sim)</Eyebrow>
            <dl className="mt-2 divide-y divide-line">
              <Row k="Supply">
                {leftLabel(row.daysLeft)} · runs out {shortDate(row.runOut)}
              </Row>
              <Row k="Lane if they refill today">
                {"lane" in row.laneNow ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LaneBadge lane={row.laneNow.lane} />
                    {row.laneNow.ruleIds.map((id) => (
                      <RuleTag key={id}>{id}</RuleTag>
                    ))}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone="stop">Refused</Badge>
                    {row.laneNow.refused.map((id) => (
                      <RuleTag key={id}>{id}</RuleTag>
                    ))}
                  </span>
                )}
              </Row>
              <Row k="Calls">{row.optedIn ? TIME_LABEL[row.preferredCallTime] : "Not opted in"}</Row>
              <Row k="Pattern">{PATTERN_LABEL[row.pattern]}</Row>
            </dl>
          </section>

          <section>
            <div className="flex items-baseline justify-between">
              <Eyebrow>Risk score · simulation&apos;s model</Eyebrow>
              <span className="text-2xl font-semibold tabular-nums">{row.risk.score}</span>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {row.risk.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <Eyebrow>Refill history, last 12 months</Eyebrow>
            <HistoryStrip events={row.history} label={`${row.drug}: ${counts.on_time} on time, ${counts.late} late, ${counts.skipped} skipped${counts.stopped ? `, ${counts.stopped} stopped` : ""}`} />
            {row.stopped.map((m) => (
              <HistoryStrip key={m.drug} events={m.history} label={`${m.drug} ${m.strength}: stopped ${longDate(m.stoppedAt)}`} />
            ))}
            <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
              {(Object.keys(FILL_TONE) as FillEvent["status"][]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span aria-hidden className={cn("size-2.5 rounded-sm", FILL_TONE[s])} />
                  {FILL_LABEL[s]}
                </span>
              ))}
            </div>
          </section>

          <section>
            <Eyebrow>Next 30 days, predicted</Eyebrow>
            {row.windowCalls.length + row.windowRefills.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Nothing happens for this prescription in the window.</p>
            ) : (
              <ol className="mt-2 space-y-1.5 text-sm">
                {[
                  ...row.windowCalls.map((c) => ({ at: c.at, key: `c${c.at}`, node: <><span className="text-ink">{c.source === "early_reach" ? "Early-reach call" : "Daily-check call"}</span> · {OUTCOME_LABEL[c.outcome]}{c.refilled ? ", refills on the call" : ""}</>, lane: c.lane })),
                  ...row.windowRefills.map((r) => ({ at: r.at, key: `r${r.at}`, node: <><span className="text-ink">{r.via === "call" ? "Refill on the call" : "Walks in to refill"}</span>{r.lane ? "" : ` · refused (rule ${r.ruleIds.join(", ")})`}</>, lane: r.lane })),
                ]
                  .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                  .map((e) => (
                    <li key={e.key} className="flex items-center justify-between gap-3 rounded-lg bg-sunken/60 px-3 py-2">
                      <span className="text-ink-2">
                        <span className="tabular-nums text-ink-3">{shortDate(pharmacyDate(e.at))}</span> · {e.node}
                      </span>
                      {e.lane && <LaneBadge lane={e.lane} />}
                    </li>
                  ))}
              </ol>
            )}
            <p className="mt-2 text-xs text-ink-3">
              {row.daysWithout > 0 ? `Predicted ${row.daysWithout} days without medication in the window.` : "Predicted to stay supplied through the window."}
            </p>
          </section>

          <section>
            <Eyebrow>Past calls</Eyebrow>
            {row.pastCalls.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">{row.optedIn ? "No calls yet." : "Never called: not opted in."}</p>
            ) : (
              <ol className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                {row.pastCalls
                  .slice(-8)
                  .reverse()
                  .map((c) => (
                    <li key={c.at} className="flex justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
                      <span className="tabular-nums text-ink-3">{longDate(c.at)}</span>
                      <span className={cn(c.outcome === "answered" ? "text-ink" : c.outcome === "asked_for_pharmacist" ? "text-review" : "text-ink-2")}>{OUTCOME_LABEL[c.outcome]}</span>
                    </li>
                  ))}
              </ol>
            )}
          </section>

          <section>
            <Eyebrow>Side effects reported before</Eyebrow>
            {row.sideEffects.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">None reported.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {row.sideEffects.map((s) => (
                  <li key={s.at}>
                    <span className="tabular-nums text-ink-3">{longDate(s.at)}</span> · {s.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
