// Times on the pharmacy's clock. One fixed zone, so the server and the browser print the same thing.
const ZONE = "America/Toronto";

export const time = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE }) : "";

export const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONE }) : "";

/** Full audit timestamp, including the timezone used by the pharmacy. */
export const auditTimestamp = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: ZONE,
        timeZoneName: "short",
      }).format(new Date(iso))
    : "Time not recorded";

export const label = (s: string) => s.replace(/_/g, " ");

/** Seconds between two times, or undefined. */
export function seconds(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const s = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : undefined;
}

/** True when a key press came from a text box, so page shortcuts stay out of the way. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}
