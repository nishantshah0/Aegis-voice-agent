// Plays the next N days forward over the simulated population. "Who to call" and "which
// lane" are the real code, imported and never copied:
//   - notDueReason, daysLeft and DUE_WITHIN_DAYS (app/api/_lib/outbound.ts), the daily check's own test
//   - refillPreview (same file): the real rule cards and lib/control/lanes.ts, read only
//   - control.checkOutbound (lib/control): rule 7's cards (opt-in, hours, one call per 3 days)
// They run against a throwaway in-memory store that holds only simulated patients. Nothing
// presses a button, nothing starts a call, and the live store is never touched. Everything
// the real code doesn't decide (risk, who picks up, who refills) is lib/sim/model.ts.

import { STARTING_CARDS, type Lane, type Patient, type Prescription, type RecordEntry, type Seed, type Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createMemoryStore } from "@/lib/store/memory";
import { SEED } from "@/lib/seed";
import { CALL_HOUR, CALL_OUTCOMES, generatePopulation, hashSeed, rng, type Population, type SimPatient } from "@/lib/seed/population";
import { DUE_WITHIN_DAYS, daysLeft, notDueReason, refillPreview } from "@/app/api/_lib/outbound";
import { EARLY_REACH_DAYS_LEFT, HIGH_RISK, MODEL_NOTES, historyStats, predictCall, refillOnCallChance, riskScore, selfRefillDelay } from "./model";
import type { ForecastRow, LaneCounts, Risk, SimCall, SimDay, SimHeld, SimOptions, SimRefill, SimRun, SimSummary } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** The pharmacy is in London, Ontario. The default window (late Nov to late Dec) is all EST. */
const UTC_OFFSET_HOURS = -5;
const WALK_IN_HOUR = 16;

export const DEFAULT_OPTIONS: SimOptions = { runId: "baseline", populationSeed: 20261124, populationSize: 240, outcomeSeed: 1, days: 30, earlyReach: true };

const localDate = (ms: number) => new Date(ms + UTC_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
const localMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`) - UTC_OFFSET_HOURS * HOUR_MS;
const iso = (ms: number) => new Date(ms).toISOString();
const runOutDate = (rx: Prescription) => localDate(Date.parse(rx.lastFill) + rx.daysSupplied * DAY_MS);
const noLanes = (): LaneCounts => ({ automatic: 0, quick_check: 0, review: 0 });

/**
 * A sandbox Store over the population: the real in-memory store for patients, cards and the
 * record (so rule 7's "one call per 3 days" counts the sim's own earlier calls), with
 * prescriptions read from a map the sim updates when someone refills.
 */
function sandbox(pop: Population, start: string): { store: Store; rx: Map<string, Prescription> } {
  const rx = new Map(pop.patients.flatMap((p) => p.prescriptions.map((r) => [r.id, structuredClone(r)] as const)));
  const seed: Seed = {
    now: start,
    pharmacyName: pop.pharmacyName,
    patients: pop.patients.map((p) => p.patient),
    prescriptions: [...rx.values()],
    slots: [],
    orders: [],
    cards: STARTING_CARDS,
    policy: SEED.policy,
  };
  const base = createMemoryStore(seed);
  // The record as the base store wrote it (hash chain and all), kept here so the many reads
  // the real code makes don't each copy the whole record. Nothing outside the sim sees it.
  const record: RecordEntry[] = [];
  const store: Store = {
    ...base,
    appendRecord: async (entry) => {
      const saved = await base.appendRecord(entry);
      record.push(saved);
      return saved;
    },
    listRecord: async (callId) => (callId ? record.filter((e) => e.callId === callId) : record),
    getPrescriptions: async (patientId) => [...rx.values()].filter((r) => r.patientId === patientId).map((r) => structuredClone(r)),
    getPrescription: async (rxId) => (rx.has(rxId) ? structuredClone(rx.get(rxId)!) : undefined),
  };
  return { store, rx };
}

type RxPlan = { selfRefillOn: string | null; refilledVia?: "call" | "walk_in"; calls: number; daysWithout: number; firstCall?: SimCall; firstHeld?: SimHeld };

function noCallWhy(patient: Patient, plan: RxPlan, left: number, windowDays: number): string {
  if (!patient.optedInToCalls) return "Not opted in to calls (rule 7a)";
  if (plan.firstHeld) return plan.firstHeld.by === "refill_rules" ? `Refill rules refuse it (rule ${plan.firstHeld.ruleIds.join(", ")}), so the daily check skips it` : `Rule ${plan.firstHeld.ruleIds.join(", ")} holds the call`;
  if (plan.refilledVia === "walk_in") return "Predicted to refill on their own before the daily check rings";
  if (left - DUE_WITHIN_DAYS >= windowDays) return `Runs out after the ${windowDays}-day window`;
  return "No call in the window";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 9" from YYYY-MM-DD. */
const monthDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

function callWhy(call: SimCall, runOut: string, risk: Risk): string {
  if (call.source === "early_reach") return `Simulation's model: risk ${risk.score} is ${HIGH_RISK}+, so an early reminder ${EARLY_REACH_DAYS_LEFT} days before the supply runs out on ${monthDay(runOut)}`;
  const when = runOut < localDate(Date.parse(call.at)) ? `ran out on ${monthDay(runOut)}` : `runs out on ${monthDay(runOut)}`;
  return `Supply ${when}. The daily check rings within ${DUE_WITHIN_DAYS} days of running out, then once every 3 days (rule 7d) until they refill`;
}

/** Run the simulation. Pure apart from its own sandbox store: same options, same result. */
export async function runSim(options: Partial<SimOptions> = {}, population?: Population): Promise<SimRun> {
  const opts: SimOptions = { ...DEFAULT_OPTIONS, ...options };
  const pop = population ?? generatePopulation({ seed: opts.populationSeed, size: opts.populationSize });
  const startDate = localDate(Date.parse(pop.asOf));
  const { store, rx } = sandbox(pop, pop.asOf);
  const control = createControl({ store });

  const plans = new Map<string, RxPlan>();
  const risks = new Map<string, Risk>();
  const startLeft = new Map<string, number>();
  const laneNow = new Map<string, ForecastRow["laneNow"]>();
  const byPatient = new Map(pop.patients.map((p) => [p.patient.id, p] as const));

  const schedule = (sp: SimPatient, r: Prescription, salt: string): string | null => {
    const roll = rng(hashSeed(`${opts.outcomeSeed}:self:${r.id}:${salt}`));
    const delay = selfRefillDelay(sp, r.id, roll);
    if (delay === null) return null;
    const on = Date.parse(r.lastFill) + (r.daysSupplied + delay) * DAY_MS;
    // Already overdue past their usual delay: they'd come in some time in the next ten days.
    const earliest = localMidnight(startDate) + Math.floor(roll() * 10) * DAY_MS;
    return localDate(Math.max(on, Date.parse(r.lastFill) + DAY_MS, on < localMidnight(startDate) ? earliest : on));
  };

  for (const sp of pop.patients) {
    for (const r of sp.prescriptions) {
      const left = daysLeft(r, pop.asOf);
      startLeft.set(r.id, left);
      risks.set(r.id, riskScore(sp, r.id, left));
      const preview = await refillPreview(store, sp.patient, r);
      laneNow.set(r.id, preview.kind === "lane" ? { lane: preview.lane, ruleIds: preview.ruleIds } : { refused: preview.ruleIds });
      plans.set(r.id, { selfRefillOn: schedule(sp, r, "0"), calls: 0, daysWithout: 0 });
    }
  }

  const refill = async (sp: SimPatient, r: Prescription, at: number, via: SimRefill["via"]): Promise<SimRefill> => {
    await store.setNow(iso(at));
    const preview = await refillPreview(store, sp.patient, r);
    const event: SimRefill =
      preview.kind === "lane"
        ? { at: iso(at), patientId: sp.patient.id, rxId: r.id, via, lane: preview.lane, ruleIds: preview.ruleIds, signals: preview.signals }
        : { at: iso(at), patientId: sp.patient.id, rxId: r.id, via, lane: null, ruleIds: preview.ruleIds, signals: [] };
    if (event.lane) {
      const next = { ...r, lastFill: iso(at), refillsLeft: r.refillsLeft - 1 };
      rx.set(r.id, next);
      const plan = plans.get(r.id)!;
      plan.refilledVia ??= via;
      plan.selfRefillOn = schedule(sp, next, event.at);
    }
    return event;
  };

  // Patients in the order the sim rings them through the day.
  const order = [...pop.patients].sort((a, b) => CALL_HOUR[a.preferredCallTime] - CALL_HOUR[b.preferredCallTime]);
  const days: SimDay[] = [];

  for (let d = 0; d < opts.days; d++) {
    const date = localDate(localMidnight(startDate) + d * DAY_MS + 12 * HOUR_MS);
    const midnight = localMidnight(date);
    const day: SimDay = { date, calls: [], refills: [], held: [], runOuts: [], callsByLane: noLanes(), refillsByLane: noLanes(), reviewLoad: 0, withoutMedication: 0 };

    for (const r of rx.values()) {
      if (runOutDate(r) === date) day.runOuts.push({ patientId: r.patientId, rxId: r.id });
      if (daysLeft(r, iso(midnight + 9 * HOUR_MS)) < 0) {
        day.withoutMedication++;
        plans.get(r.id)!.daysWithout++;
      }
    }

    for (const sp of order) {
      const at = midnight + CALL_HOUR[sp.preferredCallTime] * HOUR_MS;
      await store.setNow(iso(at));
      // The daily check rings each patient at most once a day, about the first prescription that qualifies.
      for (const current of await store.getPrescriptions(sp.patient.id)) {
        const left = daysLeft(current, iso(at));
        const risk = risks.get(current.id)!;
        const source = left <= DUE_WITHIN_DAYS ? "daily_check" : opts.earlyReach && risk.score >= HIGH_RISK && left === EARLY_REACH_DAYS_LEFT ? "early_reach" : null;
        if (!source) continue;
        const plan = plans.get(current.id)!;
        // A daily-check call goes through the route's own test; early reach (the sim's idea) only through the refill rules.
        const reason = source === "daily_check" ? await notDueReason(store, sp.patient, current) : null;
        const preview = await refillPreview(store, sp.patient, current);
        if (reason || preview.kind === "refused") {
          const ruleIds = reason ?? (preview.kind === "refused" ? preview.ruleIds : []);
          const held: SimHeld = { at: iso(at), patientId: sp.patient.id, rxId: current.id, ruleIds, by: "refill_rules" };
          day.held.push(held);
          plan.firstHeld ??= held;
          continue;
        }
        const check = await control.checkOutbound(sp.patient.id, current.id);
        if (!check.allowed) {
          const held: SimHeld = { at: iso(at), patientId: sp.patient.id, rxId: current.id, ruleIds: check.ruleIds, by: "rule_7" };
          day.held.push(held);
          if (!plan.calls) plan.firstHeld ??= held;
          continue;
        }
        const stats = historyStats(sp, current.id);
        const roll = rng(hashSeed(`${opts.outcomeSeed}:call:${current.id}:${date}`));
        const outcome = predictCall(stats, roll);
        const refilled = outcome === "answered" && roll() < refillOnCallChance(sp, stats);
        const call: SimCall = { at: iso(at), patientId: sp.patient.id, rxId: current.id, source, lane: preview.lane, ruleIds: preview.ruleIds, signals: preview.signals, outcome, refilled };
        day.calls.push(call);
        day.callsByLane[preview.lane]++;
        if (outcome === "asked_for_pharmacist") day.reviewLoad++;
        plan.calls++;
        plan.firstCall ??= call;
        if (refilled) day.refills.push(await refill(sp, current, at + 5 * 60 * 1000, "call"));
        break;
      }
    }

    for (const r of [...rx.values()]) {
      const plan = plans.get(r.id)!;
      if (plan.selfRefillOn !== date) continue;
      day.refills.push(await refill(byPatient.get(r.patientId)!, r, midnight + WALK_IN_HOUR * HOUR_MS, "walk_in"));
    }

    for (const e of day.refills) if (e.lane) day.refillsByLane[e.lane]++;
    day.reviewLoad += day.refillsByLane.review;
    days.push(day);
  }

  const end = iso(localMidnight(startDate) + opts.days * DAY_MS);
  const forecast: ForecastRow[] = pop.patients.flatMap((sp) =>
    sp.prescriptions.map((r): ForecastRow => {
      const plan = plans.get(r.id)!;
      const left = startLeft.get(r.id)!;
      const risk = risks.get(r.id)!;
      const runOut = runOutDate(r);
      const last = sp.pastCalls.filter((c) => c.rxId === r.id).at(-1);
      const endsLeft = daysLeft(rx.get(r.id)!, end);
      return {
        patientId: sp.patient.id,
        rxId: r.id,
        name: `${sp.patient.firstName} ${sp.patient.lastName}`,
        phone: sp.patient.phone,
        drug: `${r.drug} ${r.strength}`,
        controlled: r.controlled,
        optedIn: sp.patient.optedInToCalls,
        pattern: sp.pattern,
        daysLeft: left,
        runOut,
        risk,
        laneNow: laneNow.get(r.id)!,
        nextCall: plan.firstCall && { at: plan.firstCall.at, source: plan.firstCall.source, lane: plan.firstCall.lane, why: callWhy(plan.firstCall, runOut, risk) },
        noCallWhy: plan.firstCall ? undefined : noCallWhy(sp.patient, plan, left, opts.days),
        calls: plan.calls,
        lastOutcome: last?.outcome,
        ends: plan.refilledVia === "call" ? "refilled_by_call" : plan.refilledVia === "walk_in" ? "walk_in" : endsLeft < 0 ? "still_without" : "covered",
        daysWithout: plan.daysWithout,
      };
    }),
  );

  return { summary: summarise(opts, pop, days, forecast), days, forecast };
}

function summarise(opts: SimOptions, pop: Population, days: SimDay[], forecast: ForecastRow[]): SimSummary {
  const calls = days.flatMap((d) => d.calls);
  const refills = days.flatMap((d) => d.refills);
  const refillsByLane = noLanes();
  for (const r of refills) if (r.lane) refillsByLane[r.lane as Lane]++;
  const outcomes = Object.fromEntries(CALL_OUTCOMES.map((o) => [o, calls.filter((c) => c.outcome === o).length])) as SimSummary["totals"]["outcomes"];
  const heldByRule: Record<string, number> = {};
  const seen = new Set<string>();
  for (const h of days.flatMap((d) => d.held)) {
    for (const id of h.ruleIds) {
      if (seen.has(`${h.rxId}:${id}`)) continue;
      seen.add(`${h.rxId}:${id}`);
      heldByRule[id] = (heldByRule[id] ?? 0) + 1;
    }
  }
  return {
    simulated: true,
    runId: opts.runId,
    ranAt: new Date().toISOString(),
    start: pop.asOf,
    days: opts.days,
    populationSeed: pop.seed,
    populationSize: pop.size,
    outcomeSeed: opts.outcomeSeed,
    earlyReach: opts.earlyReach,
    sources: {
      real: [
        "Who the daily check rings: notDueReason (app/api/_lib/outbound.ts), the daily check's own test",
        "Lane and refused refills: refillPreview, the real rule cards and lib/control/lanes.ts, read only",
        "May we ring: control.checkOutbound, rule 7's cards (opt-in, 9 AM to 8 PM, one call per 3 days)",
      ],
      model: MODEL_NOTES,
    },
    totals: {
      patients: pop.patients.length,
      prescriptions: forecast.length,
      calls: calls.length,
      callsNext7: days.slice(0, 7).reduce((s, d) => s + d.calls.length, 0),
      earlyReachCalls: calls.filter((c) => c.source === "early_reach").length,
      atRisk: new Set(forecast.filter((f) => f.risk.band === "high").map((f) => f.patientId)).size,
      refills: refills.filter((r) => r.lane).length,
      refillsByLane,
      refusedRefills: refills.filter((r) => !r.lane).length,
      reviewLoad: days.reduce((s, d) => s + d.reviewLoad, 0),
      daysWithout: forecast.reduce((s, f) => s + f.daysWithout, 0),
      outcomes,
      heldByRule,
    },
  };
}
