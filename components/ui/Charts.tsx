import type { ReactNode } from "react";
import { cn } from "./cn";

// Small charts for the app, drawn from real numbers only. Thin marks, 2 px gaps between
// touching fills, 4 px rounded data ends, text in ink (never the series colour), and a
// hover title on every mark. Colours come from the tokens.

export type ChartTone = "accent" | "auto" | "quick" | "review" | "stop" | "muted";

const FILL: Record<ChartTone, string> = {
  accent: "bg-accent",
  auto: "bg-auto",
  quick: "bg-quick",
  review: "bg-review",
  stop: "bg-stop",
  muted: "bg-ink-3/50",
};

/** The colour swatch beside a legend label. */
export function Swatch({ tone, className }: { tone: ChartTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-[3px]", FILL[tone], className)} />;
}

/**
 * A trend line with a soft wash under it, for a stat tile. One series, so no legend: the
 * tile's label names it. Each point has a hover title.
 */
export function Sparkline({ values, titles, className, label }: { values: number[]; titles?: string[]; className?: string; label: string }) {
  const W = 120;
  const H = 32;
  const pad = 3;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (W - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z` : "";
  const last = pts[pts.length - 1];
  return (
    <div className={cn("relative h-8 w-full text-accent", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="size-full overflow-visible">
        <path d={area} fill="currentColor" opacity={0.1} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {pts.map(([x], i) => (
          <rect key={i} x={x - step / 2} y={0} width={Math.max(step, 4)} height={H} fill="transparent">
            <title>{titles?.[i] ?? String(values[i])}</title>
          </rect>
        ))}
      </svg>
      {/* The end dot sits outside the stretched SVG so it stays round. */}
      {last && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-surface"
          style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}
        />
      )}
    </div>
  );
}

export type Segment = { label: string; value: number; tone: ChartTone };

/**
 * A part-to-whole bar (lane mix, caught vs broken) with its legend under it. Segments
 * keep their order and colour whatever their size; empty ones drop out of the bar but
 * stay in the legend with their 0.
 */
export function StackedBar({ segments, className, legend = true, format = (n: number) => n.toLocaleString("en-US") }: { segments: Segment[]; className?: string; legend?: boolean; format?: (n: number) => string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className={className}>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-sunken" role="img" aria-label={segments.map((s) => `${s.label} ${format(s.value)}`).join(", ")}>
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.label} title={`${s.label}: ${format(s.value)} (${Math.round((s.value / total) * 100)}%)`} className={cn("h-full first:rounded-l-full last:rounded-r-full", FILL[s.tone])} style={{ flexGrow: s.value, flexBasis: 0 }} />
            ))}
      </div>
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {segments.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <Swatch tone={s.tone} />
              {s.label}
              <span className="font-medium tabular-nums text-ink">{format(s.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type Column = { key: string; title: string; label?: ReactNode; segments: { value: number; tone: ChartTone }[]; highlight?: boolean };

/**
 * Columns over time (calls per day), stacked by part. Bars are at most 24 px wide with air
 * between them; the top of each column is rounded, the baseline square. `label` prints
 * under a column (keep them sparse).
 */
export function Columns({ columns, height = 96, className }: { columns: Column[]; height?: number; className?: string }) {
  const max = Math.max(1, ...columns.map((c) => c.segments.reduce((s, x) => s + x.value, 0)));
  return (
    <div className={className}>
      <div className="relative flex items-end gap-[3px] border-b border-line" style={{ height }}>
        {columns.map((c) => {
          const total = c.segments.reduce((s, x) => s + x.value, 0);
          return (
            <div key={c.key} title={c.title} className="group flex h-full min-w-0 flex-1 items-end justify-center">
              <div className={cn("flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity group-hover:opacity-80", c.highlight && "outline outline-1 outline-offset-2 outline-ink-3")} style={{ height: `${(total / max) * 100}%` }}>
                {c.segments
                  .filter((s) => s.value > 0)
                  .map((s, i) => (
                    <span key={i} className={cn("w-full shrink-0", FILL[s.tone])} style={{ flexGrow: s.value, flexBasis: 0 }} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[10px] tabular-nums text-ink-3">
        {columns.map((c) => (
          <span key={c.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {c.label ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
