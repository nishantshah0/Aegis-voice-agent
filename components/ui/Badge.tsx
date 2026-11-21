import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "accent" | "quick" | "review" | "stop";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  quick: "bg-quick-soft text-quick",
  review: "bg-review-soft text-review",
  stop: "bg-stop-soft text-stop",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  quick: "bg-quick",
  review: "bg-review",
  stop: "bg-stop",
};

export function Badge({ tone = "neutral", dot = false, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

export type Lane = "automatic" | "quick_check" | "review";

export const LANE_LABEL: Record<Lane, string> = { automatic: "Automatic", quick_check: "Quick check", review: "Review" };
export const LANE_TONE: Record<Lane, Tone> = { automatic: "accent", quick_check: "quick", review: "review" };

/** The three triage lanes, always in the same colours. */
export function LaneBadge({ lane, className }: { lane: Lane; className?: string }) {
  return (
    <Badge tone={LANE_TONE[lane]} dot className={className}>
      {LANE_LABEL[lane]}
    </Badge>
  );
}

/** A rule id (1, 4b, S4...) in the record's mono style. */
export function RuleTag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md border border-line-strong px-1.5 font-mono text-[11px] leading-5 text-ink-2", className)}>{children}</span>;
}
