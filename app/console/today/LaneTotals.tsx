import type { LaneTotals as Totals } from "./detail";

const LANE_LABEL = { automatic: "Automatic", quick_check: "Quick check", review: "Review" } as const;

// Counts only: safe to show to anyone.
export function LaneTotals({ totals }: { totals: Totals }) {
  return (
    <section className="mt-6 grid grid-cols-3 gap-3" data-testid="lane-totals">
      {(["automatic", "quick_check", "review"] as const).map((lane) => (
        <div key={lane} className="rounded border border-neutral-300 p-3">
          <div className="text-xs text-neutral-500">{LANE_LABEL[lane]}</div>
          <div className="text-2xl font-semibold">{totals[lane]}</div>
        </div>
      ))}
    </section>
  );
}
