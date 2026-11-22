import { connection } from "next/server";
import { fail } from "../../_lib/http";
import { tokenMatches } from "../../_lib/twilio";
import { clipFor } from "../../_lib/voice-gather";
import { voiceCall } from "../../_lib/voice-line";

// GET /api/voice/clip?call=<id>&t=<token>&n=<number>  (Twilio's <Play>; Trail #70)
// The audio of guarded lines this call already said, made when its turn was answered. Only by
// the call's URL token; the request picks a clip by number and can never name words to voice.
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const call = voiceCall(url.searchParams.get("call") ?? "");
  if (!call || !tokenMatches(url.searchParams.get("t"), call.twimlToken)) return fail(403, "Not from Twilio");
  const audio = clipFor(call, Number(url.searchParams.get("n")));
  if (!audio) return fail(404, "No such clip");
  return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
