import { getApprover } from "@/lib/auth/session";
import { forSpeech } from "@/lib/voice/spoken";
import { fail, readObject } from "../../../_lib/http";
import { replaySpeech } from "../../../_lib/replay-speech";
import { verifiedReplayTicket } from "../../../_lib/replay-tickets";

export async function POST(request: Request) {
  if (!(await getApprover())) return fail(401, "Sign in to play this call");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "ElevenLabs is unavailable");
  const body = await readObject(request);
  const line = verifiedReplayTicket(body?.ticket, key);
  if (!line) return fail(403, "Reopen the call to load its saved lines");
  const words = line.speaker === "pharmacy" ? forSpeech(line.text) : line.text;
  return replaySpeech(`replay_${line.call}`, line.speaker, words, request.signal);
}
