// What a simulation run saves under results/sim/<run>/. Every file says simulated: true.

import type { Lane, RuleId, Signal } from "@/lib/contract";
import type { AdherencePattern, CallOutcome } from "@/lib/seed/population";

export type SimOptions = {
  /** Folder name under results/sim/. */
  runId: string;
  populationSeed: number;
  populationSize: number;
  /** Seeds the predicted outcomes (who picks up, who refills). */
  outcomeSeed: number;
  days: number;
  /** The simulation's own policy idea: ring high-risk patients early too. Not in the real daily check. */
  earlyReach: boolean;
};

/** Where a call came from: the real daily check's rule, or the simulation's early-reach idea. */
export type CallSource = "daily_check" | "early_reach";

export type RiskBand = "low" | "medium" | "high";
export type Risk = { score: number; band: RiskBand; reasons: string[] };

export type SimCall = {
  at: string;
  patientId: string;
  rxId: string;
  source: CallSource;
  /** The lane a refill asked for on this call would land in (real refillPreview at that moment). */
  lane: Lane;
  ruleIds: RuleId[];
  signals: Signal[];
  outcome: CallOutcome;
  /** True when the predicted outcome is a refill on this call. */
  refilled: boolean;
};

export type SimRefill = {
  at: string;
  patientId: string;
  rxId: string;
  via: "call" | "walk_in";
  /** null when the refill rules refused it (renewal needed). */
  lane: Lane | null;
  ruleIds: RuleId[];
  signals: Signal[];
};

/** Due today, but the real code wouldn't ring: refill rules refuse, or rule 7 holds the call. */
export type SimHeld = { at: string; patientId: string; rxId: string; ruleIds: RuleId[]; by: "refill_rules" | "rule_7" };

export type LaneCounts = Record<Lane, number>;

export type SimDay = {
  date: string;
  calls: SimCall[];
  refills: SimRefill[];
  held: SimHeld[];
  /** Prescriptions whose supply runs out on this date. */
  runOuts: { patientId: string; rxId: string }[];
  /** Calls stacked by the lane a refill on that call would land in. */
  callsByLane: LaneCounts;
  /** Refills that happen this day, by lane. */
  refillsByLane: LaneCounts;
  /** Items a pharmacist would see: Review-lane refills plus callers who asked for a pharmacist. */
  reviewLoad: number;
  /** Prescriptions with no supply left at the start of the day. */
  withoutMedication: number;
};

export type ForecastRow = {
  patientId: string;
  rxId: string;
  name: string;
  phone: string;
  drug: string;
  controlled: boolean;
  optedIn: boolean;
  pattern: AdherencePattern;
  /** Days of supply left on the first day (real daysLeft). */
  daysLeft: number;
  runOut: string;
  risk: Risk;
  /** The lane a refill would land in on day one (real refillPreview), or the rules that refuse it. */
  laneNow: { lane: Lane; ruleIds: RuleId[] } | { refused: RuleId[] };
  nextCall?: { at: string; source: CallSource; lane: Lane; why: string };
  /** Why no call happens in the window, when none does. */
  noCallWhy?: string;
  calls: number;
  lastOutcome?: CallOutcome;
  /** How the window ends for this prescription. */
  ends: "refilled_by_call" | "walk_in" | "still_without" | "covered";
  daysWithout: number;
};

export type SimSummary = {
  simulated: true;
  runId: string;
  ranAt: string;
  start: string;
  days: number;
  populationSeed: number;
  populationSize: number;
  outcomeSeed: number;
  earlyReach: boolean;
  /** What is real code and what is the simulation's own model. */
  sources: { real: string[]; model: string[] };
  totals: {
    patients: number;
    prescriptions: number;
    calls: number;
    callsNext7: number;
    earlyReachCalls: number;
    atRisk: number;
    refills: number;
    refillsByLane: LaneCounts;
    refusedRefills: number;
    reviewLoad: number;
    /** Patient-days without medication, summed over the window. */
    daysWithout: number;
    outcomes: Record<CallOutcome, number>;
    /** Distinct prescriptions held, by rule id. */
    heldByRule: Record<string, number>;
  };
};

export type SimRun = { summary: SimSummary; days: SimDay[]; forecast: ForecastRow[] };
