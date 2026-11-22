// The hijack batch's progress, built only from events (press, blocked_line, score), so the
// bar moves with the real run. A pure reducer, tested without a browser.

import type { StreamEvent } from "@/lib/contract";

/** The batch's cards in the order lib/arena/hijack-batch.ts runs them (checked in a test). */
export const BATCH_ORDER = ["early_refill", "cross_patient", "new_address", "preverification_leak"] as const;
export type BatchCard = (typeof BATCH_ORDER)[number];

export type CardLive = { stopped: number; routed: number; allowed: number; lines: number };
export type BatchLive = {
  /** The batch number from the call ids (hijack_<n>_<card>); null until one is seen. */
  batch: number | null;
  cards: Partial<Record<BatchCard, CardLive>>;
  /** Score events since the batch started: one per finished card. */
  finished: number;
  caught: number;
  broken: number;
};

export const initialBatch = (): BatchLive => ({ batch: null, cards: {}, finished: 0, caught: 0, broken: 0 });

const BATCH_CALL = /^hijack_(\d+)_(.+)$/;

const isCard = (s: string): s is BatchCard => (BATCH_ORDER as readonly string[]).includes(s);

export function batchReducer(state: BatchLive, event: StreamEvent): BatchLive {
  if (event.type === "score") {
    if (state.batch === null || state.finished >= BATCH_ORDER.length) return state;
    return { ...state, finished: state.finished + 1, caught: event.caught, broken: event.broken };
  }
  if (event.type !== "press" && event.type !== "blocked_line") return state;
  const m = event.callId.match(BATCH_CALL);
  if (!m || m[1] === undefined || m[2] === undefined || !isCard(m[2])) return state; // Not a batch call (a pick is hijack_pick_…).
  const n = Number(m[1]);
  const card = m[2];
  const base = state.batch === null || n > state.batch ? { ...initialBatch(), batch: n } : state;
  if (n < (base.batch ?? 0)) return state;
  const now = base.cards[card] ?? { stopped: 0, routed: 0, allowed: 0, lines: 0 };
  const next: CardLive =
    event.type === "blocked_line"
      ? { ...now, lines: now.lines + 1 }
      : event.decision === "allowed"
        ? { ...now, allowed: now.allowed + 1 }
        : event.decision === "routed" || event.decision === "flagged"
          ? { ...now, routed: now.routed + 1 }
          : { ...now, stopped: now.stopped + 1 };
  return { ...base, cards: { ...base.cards, [card]: next } };
}

export type CardStatus = "waiting" | "running" | "done";

export function cardStatus(state: BatchLive, card: BatchCard): CardStatus {
  const i = BATCH_ORDER.indexOf(card);
  if (i < state.finished) return "done";
  return state.cards[card] ? "running" : "waiting";
}

export const batchDone = (s: BatchLive): boolean => s.batch !== null && s.finished >= BATCH_ORDER.length;
