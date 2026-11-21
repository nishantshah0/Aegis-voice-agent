// The stage view's state, built only from events (DESIGN 3.6: the gate animation is
// driven purely by press and blocked_line events). A pure reducer, so it's tested
// without a browser and every number on the projector comes from a real event.

import type { Lane, PressDecision, StreamEvent } from "@/lib/contract";

export type Gate = "button" | "speech";

export type Pass = {
  id: number;
  gate: Gate;
  /** Button name, or the speech rule that fired. */
  label: string;
  decision: PressDecision | "blocked";
  ruleIds: string[];
  lane?: Lane;
  /** For blocked lines: what the agent tried to say, and what was said instead. */
  original?: string;
  replacement?: string;
  callId: string;
};

export type StageState = {
  passes: Pass[];
  counts: Record<PressDecision | "blocked", number>;
  lanes: Record<Lane, number>;
  /** From Role 3's hijack batch "score" events. Undefined until the first one. */
  score?: { caught: number; broken: number };
  now?: string;
  events: number;
};

export const MAX_PASSES = 40;

export const initialStage = (): StageState => ({
  passes: [],
  counts: { allowed: 0, routed: 0, refused: 0, flagged: 0, blocked: 0 },
  lanes: { automatic: 0, quick_check: 0, review: 0 },
  events: 0,
});

/** Stopped at a gate: a refused press or a blocked line. */
export const stopped = (s: StageState): number => s.counts.refused + s.counts.blocked;

export function stageReducer(state: StageState, event: StreamEvent, id: number): StageState {
  const next: StageState = { ...state, events: state.events + 1 };
  switch (event.type) {
    case "press": {
      const pass: Pass = {
        id,
        gate: "button",
        label: event.button,
        decision: event.decision,
        ruleIds: event.ruleIds,
        lane: event.lane,
        callId: event.callId,
      };
      next.passes = [pass, ...state.passes].slice(0, MAX_PASSES);
      next.counts = { ...state.counts, [event.decision]: state.counts[event.decision] + 1 };
      return next;
    }
    case "blocked_line": {
      const pass: Pass = {
        id,
        gate: "speech",
        label: event.rule,
        decision: "blocked",
        ruleIds: [event.rule],
        original: event.original,
        replacement: event.replacement,
        callId: event.callId,
      };
      next.passes = [pass, ...state.passes].slice(0, MAX_PASSES);
      next.counts = { ...state.counts, blocked: state.counts.blocked + 1 };
      return next;
    }
    case "queue": {
      // Count each item once, when it first appears open.
      if (event.item.status !== "open") return next;
      next.lanes = { ...state.lanes, [event.item.lane]: state.lanes[event.item.lane] + 1 };
      return next;
    }
    case "score":
      next.score = { caught: event.caught, broken: event.broken };
      return next;
    case "clock":
      next.now = event.now;
      return next;
    default:
      return next;
  }
}

export const DECISION_WORDS: Record<Pass["decision"], string> = {
  allowed: "Allowed",
  routed: "To a pharmacist",
  flagged: "Flagged",
  refused: "Stopped",
  blocked: "Line replaced",
};

/** Plain words for the stage. */
export function describePass(p: Pass): string {
  if (p.gate === "speech") return `Speech rule ${p.label} replaced a line`;
  const rules = p.ruleIds.length > 0 ? ` · rule ${p.ruleIds.join(", ")}` : "";
  return `${p.label.replace(/_/g, " ")} → ${DECISION_WORDS[p.decision]}${rules}`;
}
