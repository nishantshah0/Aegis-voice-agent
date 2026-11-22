import { cn } from "@/components/ui";

const fmt = (n: number) => n.toLocaleString("en-US");

/** How far a scenario run got, from its saved scoreboard. */
export function Progress({ done, total, live }: { done: number; total: number; live: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-3">
        <span>{live ? "Running now" : done >= total ? "Finished" : "Stopped before the end"}</span>
        <span className="tabular-nums">
          {fmt(done)} of {fmt(total)} scenarios
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className={cn("h-full rounded-full bg-accent transition-[width] duration-700", live && "suite-bar-live")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
