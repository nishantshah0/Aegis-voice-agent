"use client";

import { cn, LANE_LABEL, type Lane } from "@/components/ui";
import type { OutreachDay } from "./data";
import { dayLabel, shortDate, weekday } from "./format";

const LANES: Lane[] = ["automatic", "quick_check", "review"];
const BAR: Record<Lane, string> = { automatic: "bg-auto", quick_check: "bg-quick", review: "bg-review" };

/**
 * Calls per day over the window, each bar stacked by the lane a refill on that call would land
 * in. Under it, the pharmacist's predicted Review load. Click a day to filter the table.
 */
export function Calendar({ days, selected, onSelect }: { days: OutreachDay[]; selected: string | null; onSelect: (date: string | null) => void }) {
  const most = Math.max(1, ...days.map((d) => d.calls));
  const mostReview = Math.max(1, ...days.map((d) => d.reviewLoad));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
          {LANES.map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", BAR[l])} />
              {LANE_LABEL[l]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm border border-dashed border-ink-3" />
            Early reach (simulation&apos;s model)
          </span>
        </div>
        {selected && (
          <button type="button" onClick={() => onSelect(null)} className="text-xs font-medium text-accent hover:underline">
            Showing {dayLabel(selected)} · clear
          </button>
        )}
      </div>

      <ol className="mt-4 grid grid-flow-col auto-cols-fr gap-1" data-testid="outreach-calendar">
        {days.map((d, i) => {
          const isSel = selected === d.date;
          const monday = weekday(d.date) === "Mon";
          return (
            <li key={d.date} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(isSel ? null : d.date)}
                title={`${dayLabel(d.date)}: ${d.calls} calls (${d.callsByLane.automatic} automatic, ${d.callsByLane.quick_check} quick check, ${d.callsByLane.review} review${d.earlyReach ? `, ${d.earlyReach} early reach` : ""}). Review load ${d.reviewLoad}. Simulated.`}
                aria-pressed={isSel}
                aria-label={`${dayLabel(d.date)}, ${d.calls} simulated calls`}
                className={cn("group flex w-full flex-col items-stretch gap-1 rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent", isSel && "bg-accent-soft")}
              >
                <span className="text-center text-[10px] tabular-nums text-ink-3">{d.calls || ""}</span>
                <span className="flex h-36 flex-col-reverse overflow-hidden rounded-md bg-sunken group-hover:bg-line">
                  {LANES.map((l) =>
                    d.callsByLane[l] > 0 ? <span key={l} className={cn("w-full", BAR[l])} style={{ height: `${(d.callsByLane[l] / most) * 100}%` }} /> : null,
                  )}
                </span>
                <span className="flex h-1.5 justify-center">
                  {d.earlyReach > 0 && <span className="h-1.5 w-3/4 rounded-full border border-dashed border-ink-3" />}
                </span>
                <span className={cn("text-center text-[10px] tabular-nums", i === 0 ? "font-semibold text-ink" : monday ? "text-ink-2" : "text-ink-3")}>{Number(d.date.slice(8))}</span>
                <span className="h-3 text-center text-[9px] font-medium uppercase tracking-wide text-ink-3">{i === 0 || d.date.endsWith("-01") ? shortDate(d.date).slice(0, 3) : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-xs text-ink-3">Day one rings everyone already due or out of supply, so it starts high.</p>

      <div className="mt-4">
        <p className="text-xs text-ink-3">Review load per day: Review-lane refills plus callers who asked for a pharmacist</p>
        <ol className="mt-1.5 grid grid-flow-col auto-cols-fr gap-1" aria-label="Predicted review load per day">
          {days.map((d) => (
            <li key={d.date} className="flex flex-col items-center gap-0.5" title={`${dayLabel(d.date)}: ${d.reviewLoad} for a pharmacist (simulated)`}>
              <span className="flex h-8 w-full items-end overflow-hidden rounded bg-sunken">
                {d.reviewLoad > 0 && <span className="w-full rounded bg-review/70" style={{ height: `${Math.max(12, (d.reviewLoad / mostReview) * 100)}%` }} />}
              </span>
              <span className="text-[10px] tabular-nums text-ink-3">{d.reviewLoad}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
