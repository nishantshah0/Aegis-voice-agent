import { emit } from "@/lib/events";
import { createSpeechGuard } from "@/lib/guard";
import { forSpeech } from "@/lib/voice/spoken";
import { takeSpeechChars } from "./phone";
import { getStore } from "./runtime";
import { publicOrigin } from "./twilio";
import type { VoiceCall } from "./voice-line";

// The trial-safe phone line (Trail #70). A Twilio trial won't run <Connect><Stream>, so no
// ElevenLabs agent sits on the call. Instead each turn is plain TwiML that a trial does run:
//   <Play>  the guarded lines, voiced by ElevenLabs (or <Say> with the same words if that fails)
//   <Gather input="speech">  Twilio's speech to text, posted to /api/voice/turn
//   <Redirect>  to /api/voice/turn?quiet=1 when the caller said nothing
// Every word comes from the driver's guarded "line" events; nothing here writes one.

const MODEL_ID = "eleven_flash_v2_5"; // same as the /phone speak route
const DEFAULT_VOICE = "cjVigY5qzO86Huf0OWal"; // the phone-line agent's voice when ELEVENLABS_VOICE_ID isn't set
const MAX_CHARS = 1000;
const MAX_CHARS_PER_HOUR = 20_000; // shared with the speak route's hourly budget

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function callUrl(call: VoiceCall, path: string, extra = ""): string {
  return `${publicOrigin()}${path}?call=${encodeURIComponent(call.callId)}&t=${call.twimlToken}${extra}`;
}

// Latency: audio for a guarded line is made once and kept, keyed by voice and words,
// so fixed lines (the opener, "I've sent a code…", check-ins) play at once from the second time,
// and each line starts voicing the moment the driver says it (prefetchLine, from voice-line).
const AUDIO = new Map<string, Promise<Buffer | undefined>>();
const AUDIO_MAX = 300;

function synth(text: string): Promise<Buffer | undefined> {
  const key = process.env.ELEVENLABS_API_KEY;
  const spoken = forSpeech(text).slice(0, MAX_CHARS);
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const cacheKey = `${voiceId}|${spoken}`;
  const cached = AUDIO.get(cacheKey);
  if (cached) return cached;
  if (!key || !spoken || !takeSpeechChars(spoken.length, MAX_CHARS_PER_HOUR)) return Promise.resolve(undefined);
  const made = (async () => {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32&optimize_streaming_latency=3`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: spoken, model_id: MODEL_ID }),
      });
      if (!res.ok) {
        console.warn(`voice: ElevenLabs text to speech answered ${res.status}`);
        AUDIO.delete(cacheKey);
        return undefined;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch {
      console.warn("voice: ElevenLabs text to speech couldn't be reached");
      AUDIO.delete(cacheKey);
      return undefined;
    }
  })();
  if (AUDIO.size >= AUDIO_MAX) AUDIO.delete(AUDIO.keys().next().value!);
  AUDIO.set(cacheKey, made);
  return made;
}

export function resetVoiceAudioForTests(): void {
  AUDIO.clear();
}

/** Start voicing a guarded line now, while the driver writes the next one. */
export function prefetchLine(text: string): void {
  if (process.env.VOICE_TWILIO_STREAM === "1") return; // the streaming path voices on ElevenLabs' side
  void synth(text);
}

/** Voice one guarded line for this call; the clip's number, or undefined if it couldn't be made. */
async function voice(call: VoiceCall, text: string): Promise<number | undefined> {
  const audio = await synth(text);
  if (!audio) return undefined;
  call.clips.push(audio);
  return call.clips.length - 1;
}

/** Said while the agent is still working on a slow turn, so the caller isn't left in silence. */
export const FILLER_LINE = "One moment.";

/**
 * A slow turn: say the filler line (through guardSentence, like every spoken word), then come
 * straight back to the same turn (`cont=1`) for the answer. Undefined if the guard won't say it.
 */
export async function fillerTwiml(call: VoiceCall): Promise<string | undefined> {
  const guarded = await createSpeechGuard({ store: getStore(), emit })(call.callId, FILLER_LINE);
  if (guarded.blocked) return undefined;
  const n = await voice(call, guarded.speak);
  const say = n === undefined ? `<Say>${xml(guarded.speak)}</Say>` : `<Play>${xml(callUrl(call, "/api/voice/clip", `&n=${n}`))}</Play>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Redirect>${xml(callUrl(call, "/api/voice/turn", "&cont=1"))}</Redirect></Response>`;
}

/** A clip made for this call, by number. Only clips of guarded lines exist; a request can't name the words. */
export function clipFor(call: VoiceCall, n: number): Buffer | undefined {
  return Number.isInteger(n) && n >= 0 ? call.clips[n] : undefined;
}

/**
 * TwiML for one turn: say `lines` (already through guardSentence), then listen again, or hang up
 * when the call is over.
 */
export async function turnTwiml(call: VoiceCall, lines: string[], hangUp: boolean): Promise<string> {
  // One clip per line, all voiced in parallel (most were started already by
  // prefetchLine while the driver was still talking), in the order the driver said them.
  const said = lines.map((l) => l.trim()).filter(Boolean);
  const clips = await Promise.all(said.map((line) => voice(call, line)));
  const say = said
    .map((line, i) => (clips[i] === undefined ? `<Say>${xml(line)}</Say>` : `<Play>${xml(callUrl(call, "/api/voice/clip", `&n=${clips[i]}`))}</Play>`))
    .join("");
  if (hangUp) return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
  const turn = callUrl(call, "/api/voice/turn");
  // The reply plays INSIDE the Gather, so the caller can talk over it (barge-in). A 1-second pause
  // ends their turn (instead of "auto"), and the phone_call model is tuned for phone audio.
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" speechTimeout="1" speechModel="phone_call" action="${xml(turn)}">${say}</Gather><Redirect>${xml(`${turn}&quiet=1`)}</Redirect></Response>`;
}
