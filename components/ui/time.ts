// One date format for the whole app: relative ("2 min ago") in the text, the full time on
// hover. Times are on the pharmacy's clock, one fixed zone, so server and browser agree.

export const ZONE = "America/Toronto";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: ZONE, ...opts });
const dayKey = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: ZONE });

/** "Tue, Nov 24, 2026, 10:00 AM EST": the hover text. */
export function absoluteTime(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) return "";
  return fmt(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** "Nov 24, 10:00 AM": a short absolute time, for tables that compare rows. */
export function shortTime(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) return "";
  return fmt(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * "just now", "4 min ago", "3 h ago", "Yesterday, 2:10 PM", "Mon, 9:05 AM", then "Jul 21"
 * (or "Jul 21, 2025" in another year). A time ahead of `now` (the demo clock runs ahead)
 * prints absolute, never "in 2 days".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const ago = now - t;
  if (ago < -MIN) return shortTime(iso);
  if (ago < MIN) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MIN)} min ago`;
  if (ago < 12 * HOUR || dayKey(t) === dayKey(now)) return `${Math.floor(ago / HOUR)} h ago`;
  const clock = fmt(iso, { hour: "numeric", minute: "2-digit" });
  if (dayKey(t) === dayKey(now - DAY)) return `Yesterday, ${clock}`;
  if (ago < 6 * DAY) return `${fmt(iso, { weekday: "short" })}, ${clock}`;
  const sameYear = fmt(iso, { year: "numeric" }) === new Date(now).toLocaleString("en-US", { timeZone: ZONE, year: "numeric" });
  return fmt(iso, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
