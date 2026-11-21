import { phoneRefused, takeSpeech } from "../../../_lib/phone";
import { fail, readObject } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

// POST /api/call/:id/speak { text } → audio/mpeg (1.5 part 2: ElevenLabs Flash out)
// The phone sends the line it's about to say (the guard's speak text, rewritten for speech
// by lib/voice); the server turns it into audio with ElevenLabs, so the key never leaves
// the server. Only the call's own phone token (or staff) may ask, with limits per request
// and per call so nobody can run up the bill. Needs ELEVENLABS_API_KEY and
// ELEVENLABS_VOICE_ID in the server's .env.

const MODEL_ID = "eleven_flash_v2_5"; // listed by GET /v1/models with can_do_text_to_speech
const MAX_CHARS = 500;
const MAX_PER_CALL = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/speak">) {
  const { id } = await ctx.params;
  if (!(await getStore().getCall(id))) return fail(404, "No such call");
  const refused = await phoneRefused(request, id);
  if (refused) return refused;

  const body = await readObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "Body must be { text: a non-empty string }");
  if (text.length > MAX_CHARS) return fail(413, `text is longer than ${MAX_CHARS} characters`);

  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return fail(503, "The voice isn't configured on this server");

  if (!takeSpeech(id, MAX_PER_CALL)) return fail(429, "This call has used its speech allowance");

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL_ID }),
    },
  );
  if (!upstream.ok || !upstream.body) return fail(502, `The voice service answered ${upstream.status}`);
  return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
