import { forSpeech } from "@/lib/voice/spoken";
import { takeSpeechChars } from "./phone";
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

/** Voice guarded lines with ElevenLabs; the clip's number, or undefined if it couldn't be made. */
async function voice(call: VoiceCall, text: string): Promise<number | undefined> {
  const key = process.env.ELEVENLABS_API_KEY;
  const spoken = forSpeech(text).slice(0, MAX_CHARS);
  if (!key || !takeSpeechChars(spoken.length, MAX_CHARS_PER_HOUR)) return undefined;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: spoken, model_id: MODEL_ID }),
    });
    if (!res.ok) {
      console.warn(`voice: ElevenLabs text to speech answered ${res.status} for ${call.callId}`);
      return undefined;
    }
    call.clips.push(Buffer.from(await res.arrayBuffer()));
    return call.clips.length - 1;
  } catch {
    console.warn(`voice: ElevenLabs text to speech couldn't be reached for ${call.callId}`);
    return undefined;
  }
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
  const text = lines.join(" ").trim();
  let say = "";
  if (text) {
    const n = await voice(call, text);
    say = n === undefined ? `<Say>${xml(text)}</Say>` : `<Play>${xml(callUrl(call, "/api/voice/clip", `&n=${n}`))}</Play>`;
  }
  if (hangUp) return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
  const turn = callUrl(call, "/api/voice/turn");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Gather input="speech" speechTimeout="auto" action="${xml(turn)}"/><Redirect>${xml(`${turn}&quiet=1`)}</Redirect></Response>`;
}
