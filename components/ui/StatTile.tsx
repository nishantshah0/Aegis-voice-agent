import type { ReactNode } from "react";
import { cn } from "./cn";
import type { Tone } from "./Badge";

const VALUE_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  accent: "text-accent",
  quick: "text-quick",
  review: "text-review",
  stop: "text-stop",
};

/**
 * A number with its label. `chart` sits under the number (a sparkline or a bar), `hint`
 * under that. `size="xl"` is for the stage and the landing page.
 */
export function StatTile({
  label,
  value,
  hint,
  chart,
  tone = "neutral",
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  chart?: ReactNode;
  tone?: Tone;
  size?: "md" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-card border border-line bg-surface shadow-card", size === "xl" ? "gap-1 p-5" : "p-4", className)}>
      <span className="truncate text-xs font-medium text-ink-3">{label}</span>
      <span className={cn("font-semibold tabular-nums tracking-[-0.03em]", size === "xl" ? "text-5xl md:text-6xl" : "mt-1.5 text-2xl leading-8", VALUE_TONE[tone])}>{value}</span>
      {chart && <div className="mt-3">{chart}</div>}
      {hint && <span className={cn("text-xs text-ink-3", size === "xl" ? "" : "mt-1.5")}>{hint}</span>}
    </div>
  );
}
