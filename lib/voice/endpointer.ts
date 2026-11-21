// End of turn (SPEC Part 5, "Voice pipeline"): don't wait for Chrome's own
// end-of-speech. Collect interim results and finalise after about 600 ms with no
// new words. Pure timing logic, with the timer passed in so tests use fake time.

export const SILENCE_MS = 600;

export type Timer = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

const realTimer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type Endpointer = {
  /** The recogniser's current guess for the whole utterance so far (interim or final). */
  heard(text: string): void;
  /** Finish now (hold-to-talk released). */
  flush(): void;
  /** Drop whatever was heard (the agent started speaking, or the call ended). */
  reset(): void;
};

export function createEndpointer(onTurn: (text: string) => void, { silenceMs = SILENCE_MS, timer = realTimer } = {}): Endpointer {
  let text = "";
  let handle: unknown;

  const stop = () => {
    if (handle !== undefined) timer.clear(handle);
    handle = undefined;
  };
  const finish = () => {
    stop();
    const turn = text.trim();
    text = "";
    if (turn) onTurn(turn);
  };

  return {
    heard(next) {
      if (next.trim() === text.trim()) return; // No new words: the silence clock keeps running.
      text = next;
      stop();
      handle = timer.set(finish, silenceMs);
    },
    flush: finish,
    reset() {
      stop();
      text = "";
    },
  };
}
