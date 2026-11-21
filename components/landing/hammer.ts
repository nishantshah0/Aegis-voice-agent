import hammer from "@/results/hammer-latest.json";

/** Totals from the latest saved hammer run (results/hammer-latest.json). Never estimated. */
export function hammerTotals() {
  const sum = (k: "sequences" | "presses" | "checks" | "broken") => hammer.reports.reduce((n, r) => n + r[k], 0);
  const exhaustive = hammer.reports.find((r) => r.kind === "exhaustive");
  const random = hammer.reports.find((r) => r.kind === "random");
  return {
    ranAt: hammer.ranAt,
    depth: hammer.depth,
    sequences: sum("sequences"),
    presses: sum("presses"),
    checks: sum("checks"),
    broken: sum("broken"),
    exhaustive: exhaustive?.sequences ?? 0,
    random: random?.sequences ?? 0,
  };
}

export const fmt = (n: number) => n.toLocaleString("en-US");
