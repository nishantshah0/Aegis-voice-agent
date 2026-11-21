import { cn } from "./cn";
import type { Tone } from "./Badge";

export type TimelineDay = { label: string; count: number; title?: string };

const BAR: Record<Tone, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  quick: "bg-quick",
  review: "bg-review",
  stop: "bg-stop",
};

/**
 * One bar per day (e.g. refills due over the next 14 days). The first day is "today"
 * and is labelled in ink. Heights are relative to the busiest day.
 */
export function TimelineStrip({ days, tone = "accent", className, ...rest }: { days: TimelineDay[]; tone?: Tone; className?: string; "data-testid"?: string }) {
  const most = Math.max(1, ...days.map((d) => d.count));
  return (
    <ol className={cn("grid grid-flow-col auto-cols-fr gap-1.5", className)} {...rest}>
      {days.map((d, i) => (
        <li key={`${d.label}-${i}`} className="flex flex-col items-center gap-1" title={d.title ?? `${d.count} · ${d.label}`}>
          <div className="flex h-14 w-full items-end overflow-hidden rounded-md bg-sunken">
            {d.count > 0 && <div className={cn("w-full rounded-md", BAR[tone])} style={{ height: `${Math.max(8, (d.count / most) * 100)}%` }} />}
          </div>
          <span className={cn("text-[11px]", i === 0 ? "font-medium text-ink" : "text-ink-3")}>{d.label}</span>
          <span className="text-[11px] tabular-nums text-ink-3">{d.count}</span>
        </li>
      ))}
    </ol>
  );
}
