import { createHash } from "node:crypto";
import { forSpeech } from "@/lib/voice/spoken";
import { fail, readObject } from "../../_lib/http";
import { replaySpeech } from "../../_lib/replay-speech";
import { verifiedReplayTicket } from "../../_lib/replay-tickets";
import { simulationAccessRefused } from "../access";

const publicScopes = new Set(["greeting_slang_recovery", "corrected_consultation_time", "sam_ordinary_refill"].map(scenario =>
  createHash("sha256").update("public-simulation/" + scenario).digest("hex"),
));

export async function POST(request: Request) {
  const denied = simulationAccessRefused(request);
  if (denied) return denied;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "ElevenLabs is unavailable on this server.");
  const body = await readObject(request);
  const line = verifiedReplayTicket(body?.ticket, key);
  if (!line || !publicScopes.has(line.call)) return fail(403, "Only spoken lines from these live simulations can be played.");
  const text = line.speaker === "pharmacy" ? forSpeech(line.text) : line.text;
  const hour = Math.floor(Date.now() / 3_600_000);
  return replaySpeech(`simulation_${hour}_${line.call}`, line.speaker, text, request.signal);
}
