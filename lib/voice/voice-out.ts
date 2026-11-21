// Which voice the phone speaks with (task 1.5).
//
// One place decides, so the phone does not have to know the difference: when a
// clip endpoint is configured, lines go to ElevenLabs Flash with Chrome's voice
// behind it as the fallback; otherwise Chrome speaks them directly, which is what
// SPEC Part 5 asks for when the key is not set.
//
// The swap is this function's `clipEndpoint` argument and nothing else, so
// turning the better voice on is a configuration change rather than a code change.

import { createClipFetcher, createElevenLabsVoice, fixedLineTexts } from "./elevenlabs";
import { createBrowserVoice, type SpeakerHooks, type Voice } from "./speaker";

export type VoiceOutOptions = SpeakerHooks & {
  /**
   * The server route that holds the ElevenLabs key. Leave it out and the phone
   * speaks with Chrome's voice.
   */
  clipEndpoint?: string;
  /** Used to pre-record the fixed lines that name the pharmacy. */
  pharmacyName?: string;
  /** A clip that could not be fetched, after it has gone to the fallback. */
  onProblem?: (line: string, error: unknown) => void;
};

export function createVoiceOut({ clipEndpoint, pharmacyName, onSpeaking, onProblem }: VoiceOutOptions = {}): Voice {
  // Chrome's voice drives `onSpeaking` on its own when it is the only voice. As a
  // fallback it must not, or the phone would unmute the microphone between a
  // failed line and the next one: the ElevenLabs queue owns that bracket.
  if (!clipEndpoint) return createBrowserVoice({ onSpeaking });

  return createElevenLabsVoice({
    fetchClip: createClipFetcher(clipEndpoint),
    preload: fixedLineTexts(pharmacyName),
    fallback: createBrowserVoice(),
    onSpeaking,
    onProblem,
  });
}
