// The simulation's own model. None of this is in the real system: the real code has no
// adherence logic, so the risk score, the early-reach idea and every predicted outcome live
// here and are labelled "simulation's model" wherever they're shown.

import type { CallOutcome, FillEvent, SimPatient } from "@/lib/seed/population";
import type { Risk } from "./types";

/** Risk at or above this is "high", and gets the early-reach call when that's on. */
export const HIGH_RISK = 55;
export const MEDIUM_RISK = 30;
/** Early reach rings this many days before run-out (rule 3's 80% still passes on a 30-day supply). */
export const EARLY_REACH_DAYS_LEFT = 5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export type HistoryStats = { dues: number; skipped: number; late: number; avgLate: number; calls: number; picked: number; askedPharmacist: number };

export function historyStats(sp: SimPatient, rxId?: string): HistoryStats {
  const events: FillEvent[] = rxId ? (sp.history[rxId] ?? []) : Object.values(sp.history).flat();
  const late = events.filter((e) => e.status === "late");
  const calls = rxId ? sp.pastCalls.filter((c) => c.rxId === rxId) : sp.pastCalls;
  return {
    dues: events.length,
    skipped: events.filter((e) => e.status === "skipped" || e.status === "stopped").length,
    late: late.length,
    avgLate: late.length ? late.reduce((s, e) => s + e.daysLate, 0) / late.length : 0,
    calls: calls.length,
    picked: calls.filter((c) => c.outcome === "answered" || c.outcome === "asked_for_pharmacist").length,
    askedPharmacist: calls.filter((c) => c.outcome === "asked_for_pharmacist").length,
  };
}

/** Chance of picking up, from past calls, pulled towards 60% when there are few. */
export function answerChance(s: HistoryStats): number {
  return (s.picked + 0.6 * 4) / (s.calls + 4);
}

/** Of the calls they pick up, the chance they ask for a pharmacist. */
export function pharmacistChance(s: HistoryStats): number {
  return (s.askedPharmacist + 0.05 * 10) / (s.picked + 10);
}

/** Once they pick up, the chance they ask for the refill there and then. */
export function refillOnCallChance(sp: SimPatient, s: HistoryStats): number {
  const skipRate = s.dues ? s.skipped / s.dues : 0.1;
  return clamp(0.93 - 1.2 * skipRate - (sp.pattern === "recently_lapsed" ? 0.3 : 0), 0.3, 0.95);
}

/** 0 to 100, from the patient's refill and call history. `daysLeft` is supply left today. */
export function riskScore(sp: SimPatient, rxId: string, daysLeft: number): Risk {
  const s = historyStats(sp, rxId);
  const reasons: string[] = [];
  let score = 0;
  if (s.dues >= 2) {
    const skipRate = s.skipped / s.dues;
    const lateRate = s.late / s.dues;
    score += 90 * skipRate + 30 * lateRate + Math.min(10, s.avgLate / 2);
    if (s.skipped) reasons.push(`Skipped ${s.skipped} of ${s.dues} refills in 12 months`);
    if (s.late) reasons.push(`Late ${s.late} times, ${Math.round(s.avgLate)} days on average`);
  } else {
    score += 15;
    reasons.push("New patient: little refill history");
  }
  if (daysLeft < 0) {
    score += Math.min(20, 8 + Math.abs(daysLeft) / 2);
    reasons.push(`Already out of supply for ${Math.abs(daysLeft)} days`);
  }
  if (s.calls >= 2) {
    const miss = 1 - s.picked / s.calls;
    score += 20 * miss;
    if (miss >= 0.4) reasons.push(`Picked up ${s.picked} of ${s.calls} past calls`);
  }
  const rounded = Math.round(clamp(score, 0, 100));
  if (!reasons.length) reasons.push("Refills on time and picks up");
  return { score: rounded, band: rounded >= HIGH_RISK ? "high" : rounded >= MEDIUM_RISK ? "medium" : "low", reasons };
}

/** Predicted outcome of one call, from a [0, 1) roll pair. */
export function predictCall(s: HistoryStats, roll: () => number): CallOutcome {
  if (roll() < answerChance(s)) return roll() < pharmacistChance(s) ? "asked_for_pharmacist" : "answered";
  return roll() < 0.6 ? "voicemail" : "no_answer";
}

/**
 * Days after run-out the patient walks in on their own, drawn from their own history, or
 * null when they'd skip this cycle and only a call would bring them back.
 */
export function selfRefillDelay(sp: SimPatient, rxId: string, roll: () => number): number | null {
  const events = sp.history[rxId] ?? [];
  if (sp.pattern === "recently_lapsed") return roll() < 0.25 ? 5 + Math.floor(roll() * 20) : null;
  if (!events.length) return Math.floor(roll() * 5) - 2;
  const e = events[Math.floor(roll() * events.length)];
  if (e.status === "skipped" || e.status === "stopped") return null;
  return e.status === "late" ? e.daysLate : Math.floor(roll() * 4) - 3;
}

export const MODEL_NOTES = [
  "Risk score (0 to 100) from skipped and late refills, days already out, and missed calls",
  `Early reach: high-risk patients (score ${HIGH_RISK}+) are also rung ${EARLY_REACH_DAYS_LEFT} days before run-out`,
  "Who picks up, who asks for a pharmacist and who refills on the call, from each patient's past calls and refills",
  "When a patient walks in on their own, sampled from their own refill history",
  "Calls happen at the patient's preferred time: morning 10 AM, afternoon 2 PM, evening 6 PM",
  "A refill that lands in Quick check or Review is assumed approved the same day",
];
