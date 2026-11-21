import type { RecordEntry } from "@/lib/contract";
import { forSpeech } from "@/lib/voice/spoken";
import { phoneRefused, takeSpeech, takeSpeechChars } from "../../../_lib/phone";
import { fail, readObject } from "../../../_lib/http";
import { getStore } from "../../../_lib/runtime";

// POST /api/call/:id/speak { text } → audio/mpeg (1.5 part 2: ElevenLabs Flash out)
// The phone sends the line it's about to say (the guard's speak text, rewritten for speech
// by lib/voice); the server turns it into audio with ElevenLabs, so the key never leaves
// the server. Only the call's own phone token (or staff) may ask, and only for a line the
// speech guard let the agent say on this call (a line_spoken entry in its record, as written
// or as forSpeech rewrote it): the pharmacy's voice never says anything the guard didn't pass
// (Trail #47 finding). Limits per request, per call and per hour across the server keep the
// bill bounded. Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in the server's .env.

const MODEL_ID = "eleven_flash_v2_5"; // listed by GET /v1/models with can_do_text_to_speech
const MAX_CHARS = 500;
const MAX_PER_CALL = 60;
const MAX_CHARS_PER_HOUR = 20_000;

/** Whether `text` is a line the guard let the agent say, as written or as spoken. */
function saidOnCall(record: RecordEntry[], text: string): boolean {
  return record.some((e) => {
    const line = e.kind === "line_spoken" ? (e.input as { text?: unknown } | undefined)?.text : undefined;
    return typeof line === "string" && (line.trim() === text || forSpeech(line).trim() === text);
  });
}

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

  if (!saidOnCall(await getStore().listRecord(id), text)) return fail(403, "Only a line the agent said on this call can be voiced");
  if (!takeSpeech(id, MAX_PER_CALL)) return fail(429, "This call has used its speech allowance");
  if (!takeSpeechChars(text.length, MAX_CHARS_PER_HOUR)) return fail(429, "The voice has used this hour's allowance");

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
