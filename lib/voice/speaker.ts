// Speech out. Browser-only. Speaks guarded lines in order, rewritten for the ear
// (forSpeech), and says when it starts and stops so the microphone can be off
// meanwhile.
//
// Today this is Chrome's built-in voice, SPEC's fallback. ElevenLabs Flash plugs
// in behind the same Voice type once the key is on the server (task 1.5, part 2):
// the key never comes to the browser.

import { forSpeech } from "./spoken";

export type Voice = {
  /** Queue one line. Resolves when it has been spoken (or dropped by stop). */
  say(line: string): Promise<void>;
  /** Stop now and drop the queue. */
  stop(): void;
};

export type SpeakerHooks = { onSpeaking?: (speaking: boolean) => void };

export const speechOutSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

export function createBrowserVoice({ onSpeaking }: SpeakerHooks = {}): Voice {
  let pending = 0;
  const done = () => {
    pending = Math.max(0, pending - 1);
    if (pending === 0) onSpeaking?.(false);
  };

  return {
    say(line) {
      if (!speechOutSupported()) return Promise.resolve();
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(forSpeech(line));
        utterance.rate = 0.95; // A little slower: SPEC asks for slow and clear.
        utterance.onend = utterance.onerror = () => {
          done();
          resolve();
        };
        if (pending++ === 0) onSpeaking?.(true);
        window.speechSynthesis.speak(utterance);
      });
    },
    stop() {
      if (!speechOutSupported()) return;
      window.speechSynthesis.cancel();
      pending = 0;
      onSpeaking?.(false);
    },
  };
}
