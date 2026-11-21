// Turn timing (task 1.6). Four marks per turn (SPEC Part 5, "Voice pipeline"):
// caller stopped, first model text, first sentence through the guard, speech started.
// The driver records the two in the middle (server clock); the phone records the
// ends (browser clock). Each side reports times from its own start of the turn,
// so the two clocks never have to agree.

export type ServerTurnTiming = {
  /** When the driver got the caller's line, on the server's clock. */
  receivedAt: number;
  /** ms from receivedAt to the first streamed model text, if the model wrote any. */
  firstModelTextMs?: number;
  /** ms from receivedAt to the first sentence the guard returned. */
  firstGuardedMs?: number;
};

export type PhoneTurnTiming = {
  /** ms from the caller stopping (turn sent) to the first agent line arriving. */
  firstLineMs?: number;
  /** ms from the caller stopping to the voice starting to speak (voice only). */
  speechStartedMs?: number;
};

export function median(values: number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The phone's side: mark when the caller stops, then the first line and the first speech after it. */
export function createPhoneTiming(now: () => number = () => performance.now()) {
  const turns: PhoneTurnTiming[] = [];
  let stoppedAt: number | undefined;
  let current: PhoneTurnTiming | undefined;
  return {
    callerStopped() {
      stoppedAt = now();
      current = {};
      turns.push(current);
    },
    agentLine() {
      if (current && stoppedAt !== undefined && current.firstLineMs === undefined) current.firstLineMs = now() - stoppedAt;
    },
    speechStarted() {
      if (current && stoppedAt !== undefined && current.speechStartedMs === undefined) current.speechStartedMs = now() - stoppedAt;
    },
    turns: () => turns.map((t) => ({ ...t })),
    /** The median of the best end-to-end number each turn has: speech started if spoken, else first line. */
    medianMs: () => median(turns.flatMap((t) => [t.speechStartedMs ?? t.firstLineMs].filter((v): v is number => v !== undefined))),
  };
}

/** SPEC Part 4: target under 1.2 seconds from the caller's last word to the agent's first, hard limit 1.5. */
export const TURN_TARGET_MS = 1200;
export const TURN_LIMIT_MS = 1500;
