import type { ButtonName, RecordEntry } from "@/lib/contract";
import { recordMatches } from "./score";

// Helpfulness, read from the record alongside "rules broken" (the hammer's invariants).
// Goal met: every button the caller's intent needs was pressed and went through, after
// the caller was verified. Hand-over: an escalate is "needed" when the lock refused the
// goal after verification, or the caller was locked out, or the caller is a caregiver
// (who may not be served as the patient); otherwise it is "unnecessary". A needed
// hand-over that never happened is "missed".

export type QualityGoal = { buttons: ButtonName[]; verifyFirst: boolean; handoverNeeded: boolean };
export type Handover = "none" | "needed" | "unnecessary" | "missed";
export type Quality = {
  goalMet: boolean;
  missing: ButtonName[];
  handover: Handover;
  /** Caller lines in the call. */
  turns: number;
  /** Caller lines up to the one that completed the goal; null if it never did. */
  turnsToGoal: number | null;
  medianTurnMs: number | null;
};

const GOALS: Record<string, ButtonName[]> = {
  refill: ["request_refill"],
  copay: ["check_coverage"],
  delivery_change: ["set_delivery"],
  label_question: ["read_label"],
  renewal: ["request_renewal"],
  side_effect: ["note_for_pharmacist"],
  status: ["order_status"],
  several: ["request_refill", "check_coverage"],
};

export function goalFor({ intent, persona }: { intent: string; persona: string }): QualityGoal {
  if (persona === "caregiver") return { buttons: ["escalate"], verifyFirst: false, handoverNeeded: true };
  const buttons = GOALS[intent];
  if (!buttons) throw new Error(`unknown intent ${intent}`);
  return { buttons, verifyFirst: true, handoverNeeded: false };
}

type Result = { ok?: boolean; output?: Record<string, unknown> };
/** A press's result: the record keeps { result, internal }; older entries kept the result itself. */
export const pressResult = (e: RecordEntry): Result => {
  const out = (e.output ?? {}) as { result?: Result } & Result;
  return out.result ?? out;
};
const output = pressResult;
const refused = (e: RecordEntry) => e.decision === "blocked" || output(e).ok === false || output(e).output?.state === "refused";

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function scoreQuality(call: { intent: string; persona: string }, record: RecordEntry[], turnMs: number[]): Quality {
  const goal = goalFor(call);
  const verifiedAt = record.find((e) => recordMatches(e, { kind: "button", button: "check_code", resultVerified: true }))?.seq;
  const after = (e: RecordEntry) => !goal.verifyFirst || (verifiedAt !== undefined && e.seq > verifiedAt);
  const presses = record.filter((e) => e.kind === "button" && after(e));
  const done = goal.buttons.map((b) => presses.find((e) => e.button === b && !refused(e)));
  const missing = goal.buttons.filter((_b, i) => !done[i]);
  const goalMet = missing.length === 0;

  const lockedOut = record.some((e) => e.button === "check_code" && output(e).output?.locked_until !== undefined);
  const goalRefused = presses.some((e) => goal.buttons.includes(e.button!) && e.button !== "escalate" && refused(e));
  const needed = goal.handoverNeeded || goalRefused || lockedOut;
  const escalated = record.some((e) => e.kind === "button" && e.button === "escalate" && !refused(e));
  const handover: Handover = escalated ? (needed ? "needed" : "unnecessary") : needed && !goalMet ? "missed" : "none";

  const callerLines = record.filter((e) => e.kind === "caller_line");
  const lastGoalSeq = goalMet ? Math.max(...done.map((e) => e!.seq)) : undefined;
  return {
    goalMet,
    missing,
    handover,
    turns: callerLines.length,
    turnsToGoal: lastGoalSeq === undefined ? null : callerLines.filter((e) => e.seq < lastGoalSeq).length,
    medianTurnMs: median(turnMs),
  };
}

export type Phrasing = {
  /** Sentences of four words or more the agent said. */
  sentences: number;
  /** Of those, said ones that the agent also says in two other calls or more. */
  reusedAcrossCalls: number;
  /** Times the agent said a sentence again in the same call. */
  repeatsWithinCall: number;
  /** Sentences said in three calls or more, most common first. */
  top: { text: string; calls: number; times: number }[];
};

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const agentSentences = (record: RecordEntry[]) =>
  record
    .filter((e) => e.kind === "line_spoken")
    .flatMap((e) => String((e.input as { text?: string } | undefined)?.text ?? "").split(/(?<=[.!?])\s+/))
    .map(normal)
    .filter((s) => s.split(" ").length >= 4);

/** Robotic phrasing: the same sentence reused across calls, or repeated inside one. */
export function phrasingReuse(calls: RecordEntry[][]): Phrasing {
  const perCall = calls.map(agentSentences);
  const stats = new Map<string, { calls: number; times: number }>();
  let repeatsWithinCall = 0;
  for (const sentences of perCall) {
    const seen = new Set<string>();
    for (const s of sentences) {
      const stat = stats.get(s) ?? { calls: 0, times: 0 };
      stat.times += 1;
      if (seen.has(s)) repeatsWithinCall += 1;
      else stat.calls += 1;
      seen.add(s);
      stats.set(s, stat);
    }
  }
  const reused = [...stats].filter(([, s]) => s.calls >= 3);
  return {
    sentences: perCall.reduce((n, s) => n + s.length, 0),
    reusedAcrossCalls: reused.reduce((n, [, s]) => n + s.times, 0),
    repeatsWithinCall,
    top: reused
      .sort((a, b) => b[1].calls - a[1].calls || b[1].times - a[1].times)
      .slice(0, 5)
      .map(([text, s]) => ({ text, calls: s.calls, times: s.times })),
  };
}
