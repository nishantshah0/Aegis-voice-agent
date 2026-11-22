// The stage view's state, built only from events (DESIGN 3.6: the gate animation is
// driven purely by press and blocked_line events). A pure reducer, so it's tested
// without a browser and every number on the projector comes from a real event.

import type { Lane, PressDecision, QueueItem, StreamEvent } from "@/lib/contract";

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

export type TranscriptLine = {
  id: number;
  who: "agent" | "caller";
  text: string;
  /** Set when the speech guard replaced this line: the rule that fired. */
  struck?: string;
};

/** The real call on screen: the one live now, or the last one, replayed on load. */
export type StageCall = { id: string; live: boolean; lines: TranscriptLine[] };

export type StageState = {
  passes: Pass[];
  call?: StageCall;
  /** Open pharmacist queue items, newest first. */
  queue: QueueItem[];
  counts: Record<PressDecision | "blocked", number>;
  lanes: Record<Lane, number>;
  /** From Role 3's hijack batch "score" events. Undefined until the first one. */
  score?: { caught: number; broken: number };
  now?: string;
  events: number;
};

export const MAX_PASSES = 40;
export const MAX_LINES = 14;

export const initialStage = (): StageState => ({
  passes: [],
  queue: [],
  counts: { allowed: 0, routed: 0, refused: 0, flagged: 0, blocked: 0 },
  lanes: { automatic: 0, quick_check: 0, review: 0 },
  events: 0,
});

/** Stopped at a gate: a refused press or a blocked line. */
export const stopped = (s: StageState): number => s.counts.refused + s.counts.blocked;

const hijackCall = (callId: string): boolean => callId.startsWith("hijack_");

/** The call a real-call event belongs to, starting a fresh transcript when the call changes. */
function onCall(state: StageState, callId: string): StageCall | undefined {
  if (hijackCall(callId)) return state.call;
  if (state.call?.id === callId) return state.call.live ? state.call : { ...state.call, live: true };
  return { id: callId, live: true, lines: [] };
}

function addLine(call: StageCall | undefined, line: TranscriptLine): StageCall | undefined {
  return call ? { ...call, lines: [...call.lines, line].slice(-MAX_LINES) } : call;
}

export function stageReducer(state: StageState, event: StreamEvent, id: number): StageState {
  const next: StageState = { ...state, events: state.events + 1 };
  if ((event.type === "press" || event.type === "blocked_line" || event.type === "line") && !hijackCall(event.callId)) {
    next.call = onCall(state, event.callId);
  }
  switch (event.type) {
    case "line": {
      if (!hijackCall(event.callId)) next.call = addLine(next.call, { id, who: event.who, text: event.text });
      return next;
    }
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
      if (!hijackCall(event.callId)) next.call = addLine(next.call, { id, who: "agent", text: event.original, struck: event.rule });
      return next;
    }
    case "queue": {
      const others = state.queue.filter((q) => q.id !== event.item.id);
      next.queue = event.item.status === "open" ? [event.item, ...others] : others;
      // Count each item once, when it first appears open.
      if (event.item.status !== "open" || state.queue.some((q) => q.id === event.item.id)) return next;
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

/** Hijack batches tag hijack_<n>_<card>, stage picks hijack_pick_<n>_<attack> (Trail #14). */
export const isHijack = (p: Pass): boolean => p.callId.startsWith("hijack_");

/** The newest attempt by a hijacked AI, for the big gate. Never a live call's press. */
export const latestHijack = (s: StageState): Pass | undefined => s.passes.find(isHijack);

/**
 * The stage after replaying a past call's events (the latest call, loaded with the page).
 * Replayed ids are negative so they never clash with live event ids, and the call is marked
 * not live until a live event for a real call arrives.
 */
export function replayStage(events: StreamEvent[], callId?: string | null): StageState {
  const played = events.reduce((s, e, i) => stageReducer(s, e, i - events.length), initialStage());
  if (played.call) return { ...played, call: { ...played.call, live: false } };
  return callId ? { ...played, call: { id: callId, live: false, lines: [] } } : played;
}
