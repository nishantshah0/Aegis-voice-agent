import type { UpcomingRow } from "@/app/console/upcoming/upcoming";

// The Upcoming filters, applied in the browser.
export type UpcomingFilter = "all" | "soon" | "late" | "review" | "wont_ring";

export const FILTER_LABEL: Record<UpcomingFilter, string> = {
  all: "Everyone",
  soon: "Out in 3 days",
  late: "Already out",
  review: "Would need Review",
  wont_ring: "Won't be rung",
};

export function matches(row: UpcomingRow, filter: UpcomingFilter): boolean {
  if (filter === "soon") return row.daysLeft >= 0 && row.daysLeft <= 3;
  if (filter === "late") return row.daysLeft < 0;
  if (filter === "review") return row.preview.kind !== "refused" && row.preview.lane === "review";
  if (filter === "wont_ring") return !/^(today|\d{4}-)/.test(row.nextReminder);
  return true;
}

export function filterUpcoming(rows: UpcomingRow[], { filter, query, day }: { filter: UpcomingFilter; query: string; day?: string }): UpcomingRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) => matches(r, filter) && (!day || r.runOut === day) && (!q || `${r.initials} ${r.drug}`.toLowerCase().includes(q)),
  );
}

/** Who the daily check rings next: rows it would ring today first, then by run-out. */
export function nextUp(rows: UpcomingRow[]): UpcomingRow[] {
  return rows.filter((r) => r.nextReminder === "today").sort((a, b) => a.daysLeft - b.daysLeft);
}
