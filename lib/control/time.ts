// Time helpers. Always compare times with Date.parse, never as strings: ISO strings
// with different offsets ("…Z" and "…-05:00") don't sort correctly as text.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

/** The pharmacy's time zone, for rule 7's calling hours. */
export const PHARMACY_TZ = "America/Toronto";

export const ms = (iso: string): number => Date.parse(iso);

export const isBefore = (a: string, b: string): boolean => ms(a) < ms(b);

export const addMs = (iso: string, delta: number): string => new Date(ms(iso) + delta).toISOString();

/** Whole days from `from` to `to`, rounded down. */
export const daysBetween = (from: string, to: string): number => Math.floor((ms(to) - ms(from)) / DAY_MS);

/** The hour (0 to 23) on the pharmacy's wall clock. */
export function localHour(iso: string, timeZone = PHARMACY_TZ): number {
  const hour = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
  return Number(hour);
}

/** Whether `at` is within `windowMs` before `now` (inclusive of now). */
export const within = (at: string, now: string, windowMs: number): boolean =>
  ms(at) <= ms(now) && ms(now) - ms(at) <= windowMs;
