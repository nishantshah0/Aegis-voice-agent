import { presenter } from "../../phone/config";
import { ownsSession } from "../handlers";
import { latestTurn } from "../storage";
import { fail } from "../../../_lib/http";

const maxBytes = 3 * 1024 * 1024;
const audioTypes = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/aac"]);

export async function POST(request: Request) {
  const denied = presenter(request);
  if (denied) return denied;
  if (process.env.PATIENT_SIMULATION !== "community-demo" || process.env.DATABASE_URL) {
    return fail(403, "Browser voice requires the synthetic pharmacy demo.");
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "Voice transcription is unavailable. You can type your reply.");
  if (Number(request.headers.get("content-length")) > maxBytes + 65536) {
    return fail(413, "Please record a shorter reply.");
  }
  const body = await request.formData().catch(() => null);
  const sessionId = body?.get("sessionId");
  if (typeof sessionId !== "string" || !ownsSession(request, sessionId)) {
    return fail(403, "Start a browser conversation before recording a reply.");
  }
  try {
    const current = await latestTurn(sessionId);
    if (!current || current.flow.phase === "end") return fail(409, "Start a new browser conversation to record a reply.");
  } catch {
    return fail(503, "The browser conversation is unavailable. Please try again.");
  }
  const audio = body?.get("file");
  if (!(audio instanceof File) || !audio.size || !audioTypes.has(audio.type.split(";")[0])) {
    return fail(400, "Please record an audio reply.");
  }
  if (audio.size > maxBytes) return fail(413, "Please record a shorter reply.");
  const form = new FormData();
  form.set("file", audio, "reply." + (audio.type.split(";")[0].split("/")[1] || "webm"));
  form.set("model_id", "scribe_v2");
  form.set("language_code", "en");
  form.set("tag_audio_events", "false");
  form.set("timestamps_granularity", "none");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": key }, body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) return fail(502, "The microphone reply could not be transcribed. Try again or type your reply.");
    const result = await response.json();
    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) return fail(422, "No speech was heard. Try recording again.");
    return Response.json({ text }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return fail(503, "Voice transcription was interrupted. Try again or type your reply.");
  }
}
