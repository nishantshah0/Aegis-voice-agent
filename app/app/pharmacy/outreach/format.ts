// Small display helpers shared by the Outreach viewer's client components. Dates are formatted
// by hand (no locale or time zone lookups) so the server and the browser render the same text.

import type { AdherencePattern, CallOutcome, FillStatus, PreferredCallTime } from "@/lib/seed/population";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The pharmacy is in London, Ontario; the sim's window is all EST (UTC-5). */
const OFFSET_MS = -5 * 60 * 60 * 1000;

/** YYYY-MM-DD on the pharmacy's calendar, for an ISO time. */
export const pharmacyDate = (iso: string) => new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 10);

/** "Nov 24" from YYYY-MM-DD. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Tue Nov 24" from YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS[wd]} ${shortDate(date)}`;
}

export const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** "Nov 24, 2025" from an ISO time. */
export function longDate(iso: string): string {
  const date = pharmacyDate(iso);
  return `${shortDate(date)}, ${date.slice(0, 4)}`;
}

/** "2 PM" from an ISO time, on the pharmacy's clock. */
export function clock(iso: string): string {
  const h = new Date(Date.parse(iso) + OFFSET_MS).getUTCHours();
  return h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
}

export const PATTERN_LABEL: Record<AdherencePattern, string> = {
  steady: "Steady",
  often_late: "Often late",
  chronic_skipper: "Chronic skipper",
  recently_lapsed: "Recently lapsed",
  new_patient: "New patient",
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered: "Answered",
  voicemail: "Voicemail",
  no_answer: "No answer",
  asked_for_pharmacist: "Asked for a pharmacist",
};

export const FILL_LABEL: Record<FillStatus, string> = { on_time: "On time", late: "Late", skipped: "Skipped", stopped: "Stopped" };

export const TIME_LABEL: Record<PreferredCallTime, string> = { morning: "Mornings (10 AM)", afternoon: "Afternoons (2 PM)", evening: "Evenings (6 PM)" };

/** "3 days left", "today", "out 4 days". */
export function leftLabel(left: number): string {
  if (left > 0) return `${left} day${left === 1 ? "" : "s"} left`;
  if (left === 0) return "runs out today";
  return `out ${-left} day${left === -1 ? "" : "s"}`;
}
