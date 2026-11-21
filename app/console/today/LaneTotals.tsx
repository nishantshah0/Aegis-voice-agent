import { LANE_LABEL, LANE_TONE, cn } from "@/components/ui";
import type { LaneTotals as Totals } from "./detail";

const DOT = { accent: "bg-accent", quick: "bg-quick", review: "bg-review", neutral: "bg-ink-3", stop: "bg-stop" } as const;

// Counts only: safe to show to anyone.
export function LaneTotals({ totals }: { totals: Totals }) {
  return (
    <section className="mt-8 grid grid-cols-3 gap-3" data-testid="lane-totals">
      {(["review", "quick_check", "automatic"] as const).map((lane) => (
        <div key={lane} className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <span aria-hidden className={cn("size-2 rounded-full", DOT[LANE_TONE[lane]])} />
            {LANE_LABEL[lane]}
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums tracking-[-0.03em]">{totals[lane]}</div>
        </div>
      ))}
    </section>
  );
}
