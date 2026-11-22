import { fail } from "./http";
import { takeSpeech, takeSpeechChars } from "./phone";

const MAX_CHARS = 500;

// Both replay routes resolve the source line and speaker on the server before synthesis.
export async function replaySpeech(call: string, speaker: "caller" | "pharmacy", words: string, signal: AbortSignal) {
  const text = words.trim();
  if (!text) return fail(400, "Nothing was said in this turn");
  if (text.length > MAX_CHARS) return fail(413, `The line is longer than ${MAX_CHARS} characters`);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "The voice isn't configured on this server");
  if (!takeSpeech(call, 80)) return fail(429, "This call has used its speech allowance");
  if (!takeSpeechChars(text.length, 20_000)) return fail(429, "The voice has used this hour's allowance");
  const voice = speaker === "caller"
    ? process.env.ELEVENLABS_ATTACKER_VOICE_ID || "pNInz6obpgDQGcFmaJgB"
    : process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
      method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    });
    if (!upstream.ok || !upstream.body) return fail(502, `The voice service answered ${upstream.status}`);
    return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
  } catch {
    return fail(502, "Could not reach the voice service");
  }
}
