import { forSpeech } from "@/lib/voice/spoken";
import { refuseUnlessStaff } from "../../../../_lib/arena-runs";
import { fail, readObject } from "../../../../_lib/http";
import { readLiveCall } from "../../../../_lib/live-calls";
import { takeSpeech, takeSpeechChars } from "../../../../_lib/phone";

// POST /api/arena/live/:id/speak { seq, say? } → audio/mpeg (Trail #69, Role 2 stand-in)
// The sibling of Role 1's /api/call/:id/speak for live attack calls, which run on their own
// store. It voices only what was said on that call, from the saved turns: a caller line in
// the attacker's voice, a line the guard passed in the pharmacy's voice, and (say:
// "replacement") the line said instead of a blocked one. A blocked line itself is never
// voiced. Same ElevenLabs model and the same hourly character budget as the speak route;
// the key never leaves the server.

const MODEL_ID = "eleven_flash_v2_5";
const MAX_CHARS = 500;
const MAX_PER_CALL = 80;
const MAX_CHARS_PER_HOUR = 20_000;
// ElevenLabs' premade voices, used when the .env names none.
const DEFAULT_PHARMACY_VOICE = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_ATTACKER_VOICE = "pNInz6obpgDQGcFmaJgB";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  const { id } = await ctx.params;
  const call = await readLiveCall(id);
  if (!call) return fail(404, "No such live call");
  const body = await readObject(request);
  const turn = call.turns.find((t) => t.seq === body?.seq);
  if (!turn) return fail(404, "No such turn on this call");

  const pharmacyVoice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_PHARMACY_VOICE;
  const attackerVoice = process.env.ELEVENLABS_ATTACKER_VOICE_ID || DEFAULT_ATTACKER_VOICE;
  let text = "";
  let voice = "";
  if (turn.kind === "line_blocked") {
    if (body?.say !== "replacement") return fail(403, "A blocked line is never voiced");
    [text, voice] = [turn.replacement ?? "", pharmacyVoice];
  } else if (turn.kind === "safety" && body?.say === "replacement") {
    [text, voice] = [turn.replacement ?? "", pharmacyVoice];
  } else if (turn.kind === "caller_line" || turn.kind === "safety") {
    [text, voice] = [turn.text ?? "", attackerVoice];
  } else if (turn.kind === "line_spoken") {
    [text, voice] = [forSpeech(turn.text ?? ""), pharmacyVoice];
  } else {
    return fail(400, "Nothing was said in this turn");
  }
  text = text.trim();
  if (!text) return fail(400, "Nothing was said in this turn");
  if (text.length > MAX_CHARS) return fail(413, `The line is longer than ${MAX_CHARS} characters`);

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "The voice isn't configured on this server");
  if (!takeSpeech(`live_${id}`, MAX_PER_CALL)) return fail(429, "This call has used its speech allowance");
  if (!takeSpeechChars(text.length, MAX_CHARS_PER_HOUR)) return fail(429, "The voice has used this hour's allowance");

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!upstream.ok || !upstream.body) return fail(502, `The voice service answered ${upstream.status}`);
  return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
