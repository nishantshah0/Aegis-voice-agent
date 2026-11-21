// Speech out with ElevenLabs Flash (task 1.5 part 2), through the call's own speak
// route (POST /api/call/:id/speak, Role 2), so the key never reaches the browser.
// Browser-only.
//
// Each guarded line is rewritten for the ear (forSpeech), fetched as audio and
// played in order. A line said before (the fixed lines: "One moment.", the guard's
// replacements) plays from memory at once. If the route can't speak (no key on the
// server, the call's allowance used up, the route missing), that line falls back to
// the browser's own voice, so the call never goes silent.

import { forSpeech } from "./spoken";
import type { Voice } from "./speaker";

export type Clip = { url: string; label: string };
export type AudioPlayer = (clip: Clip) => { done: Promise<void>; stop(): void };

/** Plays a clip with an <audio> element. */
export const playInBrowser: AudioPlayer = (clip) => {
  const audio = new Audio(clip.url);
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
    audio.onended = audio.onerror = () => resolve();
  });
  audio.play().catch(() => finish());
  return {
    done,
    stop() {
      audio.pause();
      finish();
    },
  };
};

export type ServerVoiceOptions = {
  callId: string;
  token?: string;
  fallback: Voice;
  onSpeaking?: (speaking: boolean) => void;
  fetch?: typeof fetch;
  play?: AudioPlayer;
  toUrl?: (audio: Blob) => string;
};

export function createServerVoice({
  callId,
  token,
  fallback,
  onSpeaking,
  fetch: doFetch = (...args) => fetch(...args),
  play = playInBrowser,
  toUrl = (b) => URL.createObjectURL(b),
}: ServerVoiceOptions): Voice {
  const cache = new Map<string, string>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  let generation = 0; // bumped by stop(): queued lines from before it are dropped
  let current: { stop(): void } | undefined;

  async function audioFor(spoken: string): Promise<string | undefined> {
    const cached = cache.get(spoken);
    if (cached) return cached;
    try {
      const res = await doFetch(`/api/call/${encodeURIComponent(callId)}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "x-phone-token": token } : {}) },
        body: JSON.stringify({ text: spoken }),
      });
      if (!res.ok) return undefined;
      const url = toUrl(await res.blob());
      cache.set(spoken, url);
      return url;
    } catch {
      return undefined;
    }
  }

  async function speakOne(line: string, mine: number) {
    if (mine !== generation) return;
    const url = await audioFor(forSpeech(line));
    if (mine !== generation) return;
    if (!url) {
      await fallback.say(line); // the fallback rewrites numbers itself
      return;
    }
    const playing = play({ url, label: line });
    current = playing;
    await playing.done;
    current = undefined;
  }

  return {
    say(line) {
      const mine = generation;
      if (pending++ === 0) onSpeaking?.(true);
      queue = queue.then(() => speakOne(line, mine)).finally(() => {
        if (mine !== generation) return; // dropped by stop(), which already said it stopped
        pending = Math.max(0, pending - 1);
        if (pending === 0) onSpeaking?.(false);
      });
      return queue;
    },
    stop() {
      generation++;
      current?.stop();
      fallback.stop();
      if (pending > 0) {
        pending = 0;
        onSpeaking?.(false);
      }
    },
  };
}
