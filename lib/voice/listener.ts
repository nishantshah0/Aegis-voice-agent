// Speech in: Chrome's built-in speech recognition (no key). Browser-only.
//
// Interim results feed the endpointer, which ends the turn after 600 ms of
// silence. While the agent speaks the microphone is off (pause/resume), so the
// phone's own speaker isn't heard as the caller. Hold-to-talk listens only while
// the button is held, for a loud room.

import { createEndpointer, SILENCE_MS } from "./endpointer";

// The Web Speech API isn't in TypeScript's DOM types, so just the parts we use.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechInSupported = (): boolean => recognitionCtor() !== undefined;

export type ListenerMode = "open" | "hold";

export type ListenerOptions = {
  onTurn: (text: string) => void;
  /** What's been heard so far this turn, for the screen. */
  onHearing?: (text: string) => void;
  onProblem?: (text: string) => void;
  silenceMs?: number;
  lang?: string;
};

export type Listener = {
  /** Start listening (open mode) or get ready (hold mode). */
  start(mode: ListenerMode): void;
  /** Microphone off while the agent speaks. */
  pause(): void;
  resume(): void;
  holdDown(): void;
  holdUp(): void;
  stop(): void;
};

export function createListener({ onTurn, onHearing, onProblem, silenceMs = SILENCE_MS, lang = "en-US" }: ListenerOptions): Listener {
  const Ctor = recognitionCtor();
  let mode: ListenerMode = "open";
  let active = false;
  let paused = false;
  let held = false;
  let running = false;
  let rec: Recognition | undefined;

  const shouldRun = () => active && !paused && (mode === "open" || held);

  const endpointer = createEndpointer(
    (text) => {
      onHearing?.("");
      onTurn(text);
      // Start a fresh recognition so the next turn doesn't repeat this one's words.
      restart();
    },
    { silenceMs },
  );

  function open() {
    if (!Ctor || running || !shouldRun()) return;
    rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      const text = Array.from(e.results, (r) => r[0].transcript).join(" ").replace(/\s+/g, " ").trim();
      onHearing?.(text);
      endpointer.heard(text);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        active = false;
        onProblem?.("The microphone isn't allowed. Allow it in the browser, or type instead.");
      }
    };
    // Chrome stops on its own now and then; keep listening while we should be.
    rec.onend = () => {
      running = false;
      if (shouldRun()) open();
    };
    running = true;
    rec.start();
  }

  function close() {
    running = false;
    const r = rec;
    rec = undefined;
    if (r) {
      r.onend = null;
      r.abort();
    }
  }

  function restart() {
    close();
    open();
  }

  return {
    start(m) {
      if (!Ctor) {
        onProblem?.("This browser has no speech recognition. Use Chrome, or type instead.");
        return;
      }
      mode = m;
      active = true;
      open();
    },
    pause() {
      paused = true;
      endpointer.reset();
      onHearing?.("");
      close();
    },
    resume() {
      paused = false;
      open();
    },
    holdDown() {
      held = true;
      open();
    },
    holdUp() {
      held = false;
      endpointer.flush();
      close();
    },
    stop() {
      active = false;
      endpointer.reset();
      close();
    },
  };
}
