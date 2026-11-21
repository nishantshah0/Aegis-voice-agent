// Speech out through ElevenLabs Flash (task 1.5, part 2), behind the same `Voice`
// type as Chrome's built-in voice, so the phone swaps one for the other.
//
// The key never reaches the browser. This fetches finished audio from a server
// route that holds the key, so the only thing crossing to the page is a clip.
//
// `say` takes only text the speech guard has already passed. Nothing reaches
// ElevenLabs without going through `guardSentence` first: the phone speaks the
// transcript, and only `speak` from a `GuardResult` ever lands there. This module
// rewrites that text for the ear (`forSpeech`) and sends it on; it never composes
// a line of its own.
//
// Three things it has to get right:
//   * Lines are spoken in the order the guard released them, one at a time.
//   * `onSpeaking` brackets the whole queue, because the phone mutes the
//     microphone while the agent speaks (`app/phone/useVoice.ts`).
//   * A clip that cannot be fetched or played falls back to Chrome's voice
//     rather than dropping the line. SPEC Part 5 makes Chrome the fallback, and
//     a silent agent is worse than one that changes voice mid-call.
//
// Server route contract (Role 2's folder, so it is a REQUEST, not built here):
//   POST <endpoint>  { "text": "<already rewritten for the ear>" }
//   200 -> audio bytes (audio/mpeg)   non-200 -> this falls back to Chrome
// The text arrives already run through `forSpeech`, so the route synthesises it
// as given and never has to know about codes, money or doses.

import {
  ASK_TO_VERIFY,
  CODE_SENT,
  HOLDING,
  MISSED_DOSES_CHECK_IN,
  REFILL_SYNC_OFFER,
  SIDE_EFFECT_PASSED_ON,
  STILL_THERE,
  inboundGreeting,
  outboundWrongPerson,
} from "@/lib/agent/lines";

import type { SpeakerHooks, Voice } from "./speaker";
import { forSpeech } from "./spoken";

/** The audio for one line, as the server returned it. */
export type Clip = ArrayBuffer;

/** Fetches audio for text that is already in spoken form. */
export type FetchClip = (spoken: string, signal: AbortSignal) => Promise<Clip>;

export type Playing = {
  /** Resolves when the clip finishes, errors, or is stopped. */
  ended: Promise<void>;
  stop: () => void;
};

export type PlayClip = (clip: Clip) => Playing;

export type ElevenLabsVoiceOptions = SpeakerHooks & {
  fetchClip: FetchClip;
  /** Injected in tests; defaults to an `Audio` element. */
  play?: PlayClip;
  /** Lines worth keeping after the first fetch. See `fixedLineTexts`. */
  preload?: readonly string[];
  /** Chrome's voice, for a line whose clip did not arrive. */
  fallback?: Voice;
  onProblem?: (line: string, error: unknown) => void;
};

export const VOICE_CLIP_ENDPOINT = "/api/voice/clip";

/**
 * The fixed lines, which are the same every call and so are worth holding on to:
 * SPEC Part 5 asks for the fixed lines pre-recorded.
 *
 * `outboundOpener` is deliberately absent. It carries the patient's name, so a
 * cached clip of it would be one patient's audio waiting to be played to the
 * next one.
 */
export function fixedLineTexts(pharmacyName?: string): string[] {
  const named = pharmacyName ? [inboundGreeting(pharmacyName), outboundWrongPerson(pharmacyName)] : [];
  return [
    ...named,
    ASK_TO_VERIFY,
    CODE_SENT,
    HOLDING,
    STILL_THERE,
    REFILL_SYNC_OFFER,
    SIDE_EFFECT_PASSED_ON,
    MISSED_DOSES_CHECK_IN,
  ];
}

/** Posts the spoken text to the server route and returns the audio it sends back. */
export function createClipFetcher(endpoint: string = VOICE_CLIP_ENDPOINT): FetchClip {
  return async (spoken, signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: spoken }),
      signal,
    });
    if (!response.ok) throw new Error(`voice clip ${response.status}`);
    return response.arrayBuffer();
  };
}

function playClipInBrowser(clip: Clip): Playing {
  const url = URL.createObjectURL(new Blob([clip], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  let settled = false;
  let finish = () => {};
  const ended = new Promise<void>((resolve) => {
    finish = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve();
    };
  });
  audio.onended = () => finish();
  audio.onerror = () => finish();
  void audio.play().catch(() => finish());
  return {
    ended,
    stop: () => {
      audio.pause();
      finish();
    },
  };
}

type Queued = { line: string; spoken: string; done: () => void };

export function createElevenLabsVoice({
  fetchClip,
  play = playClipInBrowser,
  preload = [],
  fallback,
  onSpeaking,
  onProblem,
}: ElevenLabsVoiceOptions): Voice {
  const keep = new Set(preload.map(forSpeech));
  const clips = new Map<string, Clip>();
  let queue: Queued[] = [];
  let speaking = false;
  let draining = false;
  /** Bumped by `stop`, so work already in flight knows it has been dropped. */
  let generation = 0;
  let playing: Playing | undefined;
  let fetching: AbortController | undefined;

  const setSpeaking = (next: boolean) => {
    if (speaking === next) return;
    speaking = next;
    onSpeaking?.(next);
  };

  async function speakOne(item: Queued, mine: number): Promise<void> {
    let clip = clips.get(item.spoken);
    if (!clip) {
      fetching = new AbortController();
      try {
        clip = await fetchClip(item.spoken, fetching.signal);
      } finally {
        fetching = undefined;
      }
      if (generation !== mine) return;
      if (keep.has(item.spoken)) clips.set(item.spoken, clip);
    }
    playing = play(clip);
    try {
      await playing.ended;
    } finally {
      playing = undefined;
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      const mine = generation;
      const item = queue[0];
      try {
        await speakOne(item, mine);
      } catch (error) {
        if (generation === mine) {
          onProblem?.(item.line, error);
          // Chrome's voice says the line instead, so the call keeps going.
          try {
            await fallback?.say(item.line);
          } catch {
            // The fallback is best effort: a line nobody can speak is still dropped.
          }
        }
      }
      // `stop` already emptied the queue and resolved everything in it.
      if (generation !== mine) break;
      queue.shift();
      item.done();
    }
    draining = false;
    if (queue.length === 0) setSpeaking(false);
  }

  return {
    say(line) {
      const spoken = forSpeech(line);
      return new Promise<void>((resolve) => {
        queue.push({ line, spoken, done: resolve });
        // Before any audio starts, matching Chrome's voice: the microphone has
        // to be muted by the time the first sound comes out.
        setSpeaking(true);
        void drain();
      });
    },
    stop() {
      generation += 1;
      fetching?.abort();
      fetching = undefined;
      playing?.stop();
      playing = undefined;
      const dropped = queue;
      queue = [];
      setSpeaking(false);
      // Resolve rather than reject: callers treat a stopped line as spoken-enough.
      for (const item of dropped) item.done();
    },
  };
}
