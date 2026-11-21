// Silence handling (task 1.8). Armed when the agent has finished speaking and the
// phone is listening; if the caller says nothing for a while, it fires once, and
// the phone asks the agent to check in ("Are you still there?").

export const SILENCE_PROMPT_MS = 8000;

export type SilenceWatch = {
  /** Start (or restart) the silence clock. */
  arm(): void;
  /** The caller spoke, or the agent is speaking: stop the clock. */
  cancel(): void;
};

export function createSilenceWatch(onSilence: () => void, ms = SILENCE_PROMPT_MS): SilenceWatch {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
  };
  return {
    arm() {
      cancel();
      handle = setTimeout(() => {
        handle = undefined;
        onSilence();
      }, ms);
    },
    cancel,
  };
}
