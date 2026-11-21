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

/** A big tabular number with a label. `size="xl"` is for the stage and the landing page. */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: "md" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border border-line bg-surface p-5", className)}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <span className={cn("font-semibold tabular-nums tracking-[-0.03em]", size === "xl" ? "text-5xl md:text-6xl" : "text-3xl", VALUE_TONE[tone])}>{value}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </div>
  );
}
