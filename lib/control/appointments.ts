// Appointments (Trail #85). Slots come from the store's policy (a weekly, made-up schedule)
// and the store's clock: the next 14 days, pharmacy time. Bookings are kept only in the
// hash-chained record: a book_appointment entry is a booking until a cancel_appointment
// entry names it. Nothing here comes from the AI.

import {
  DEFAULT_APPOINTMENT_SCHEDULE,
  type Appointment,
  type AppointmentSlot,
  type AppointmentTemplate,
  type AppointmentType,
  type Policy,
  type RecordEntry,
  type RuleContext,
} from "@/lib/contract";
import { internalOf, resultOf } from "./context";
import { DAY_MS, ms, PHARMACY_TZ } from "./time";

export const APPOINTMENT_DAYS = 14;
export const MAX_LISTED_SLOTS = 10;

type Local = { y: number; m: number; d: number; weekday: number; hour: number; minute: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The pharmacy's wall clock at `t`. */
export function localParts(t: number, timeZone = PHARMACY_TZ): Local {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "long", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: WEEKDAYS.indexOf(parts.weekday), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Minutes the pharmacy's clock is ahead of UTC at `t` (−300 in November). */
function offsetMinutes(t: number, timeZone = PHARMACY_TZ): number {
  const l = localParts(t, timeZone);
  return Math.round((Date.UTC(l.y, l.m - 1, l.d, l.hour, l.minute) - Math.floor(t / 60000) * 60000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A pharmacy wall-clock time as ISO with its offset, e.g. "2026-11-26T10:00:00-05:00". */
export function localIso(y: number, m: number, d: number, hour: number, minute: number): string {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let offset = offsetMinutes(guess);
  offset = offsetMinutes(guess - offset * 60000);
  const sign = offset <= 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const ordinal = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;

/**
 * "Thursday the 26th at 10 AM". No month name: "November 30" is also how a date of birth is
 * said, and S2 would rightly block it for every other patient.
 */
export function slotLabel(l: Local): string {
  const h12 = l.hour % 12 === 0 ? 12 : l.hour % 12;
  const time = l.minute === 0 ? `${h12} ${l.hour < 12 ? "AM" : "PM"}` : `${h12}:${pad(l.minute)} ${l.hour < 12 ? "AM" : "PM"}`;
  return `${WEEKDAYS[l.weekday]} the ${ordinal(l.d)} at ${time}`;
}

export const scheduleOf = (policy: Policy): AppointmentTemplate[] =>
  Array.isArray(policy.appointmentSchedule) && policy.appointmentSchedule.length > 0 ? policy.appointmentSchedule : DEFAULT_APPOINTMENT_SCHEDULE;

const TIME = /^(\d{2}):(\d{2})$/;

/** Every slot (taken or not) that starts after `now` and within the next 14 days, earliest first. */
export function slotsFrom(now: string, policy: Policy): AppointmentSlot[] {
  const out: AppointmentSlot[] = [];
  const nowMs = ms(now);
  for (let k = 0; k <= APPOINTMENT_DAYS; k++) {
    const day = localParts(nowMs + k * DAY_MS);
    for (const t of scheduleOf(policy)) {
      if (!t.weekdays.includes(day.weekday)) continue;
      for (const time of t.times) {
        const m = TIME.exec(time);
        if (!m) continue;
        const start = localIso(day.y, day.m, day.d, Number(m[1]), Number(m[2]));
        const startMs = ms(start);
        if (startMs <= nowMs || startMs > nowMs + APPOINTMENT_DAYS * DAY_MS) continue;
        const end = new Date(startMs + Math.max(5, t.minutes) * 60000).toISOString();
        out.push({
          id: `ap_${t.type}_${day.y}${pad(day.m)}${pad(day.d)}_${m[1]}${m[2]}`,
          type: t.type,
          label: slotLabel(localParts(startMs)),
          start,
          end,
        });
      }
    }
  }
  return out.sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id));
}

/** Live bookings, read from the record: booked and not since cancelled. */
export function liveAppointments(record: RecordEntry[]): Appointment[] {
  const booked = new Map<string, Appointment>();
  for (const e of record) {
    if (e.kind !== "button") continue;
    const r = resultOf(e);
    const ok = r?.ok === true && (r.output as { ok?: boolean }).ok === true;
    const appointment = internalOf(e)?.appointment;
    if (!ok || !appointment) continue;
    if (e.button === "book_appointment") booked.set(appointment.appointmentId, appointment);
    if (e.button === "cancel_appointment") booked.delete(appointment.appointmentId);
  }
  return [...booked.values()];
}

const localDate = (iso: string) => {
  const l = localParts(ms(iso));
  return `${l.y}-${l.m}-${l.d}`;
};

/** Everything a book_appointment card reads. */
export function appointmentContext(slot: AppointmentSlot, patientId: string, callerId: string | undefined, live: Appointment[]): RuleContext {
  return {
    "call.caller_type": callerId ? "patient" : "unverified",
    "appointment.slot_free": !live.some((a) => a.slotId === slot.id),
    "appointment.local_hour": localParts(ms(slot.start)).hour,
    "appointment.same_type_same_day": live.filter((a) => a.patientId === patientId && a.type === slot.type && localDate(a.start) === localDate(slot.start)).length,
    "appointment.patient_is_caller": callerId !== undefined && patientId === callerId,
  };
}

export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 18;

/**
 * The same checks in code, so they hold even on a store whose rule book predates cards 13a to
 * 13e (an older Postgres seed). Returns the rule ids that refuse, in card order.
 */
export function appointmentFloor(ctx: RuleContext): string[] {
  const ids: string[] = [];
  if (ctx["appointment.slot_free"] !== true) ids.push("13a");
  const hour = ctx["appointment.local_hour"];
  if (typeof hour !== "number" || hour < OPEN_HOUR) ids.push("13b");
  if (typeof hour !== "number" || hour >= CLOSE_HOUR) ids.push("13c");
  if (ctx["appointment.same_type_same_day"] !== 0) ids.push("13d");
  if (ctx["appointment.patient_is_caller"] !== true) ids.push("13e");
  return ids;
}

export const isAppointmentType = (t: string): t is AppointmentType => ["consult", "vaccine", "med_review", "pickup"].includes(t);
