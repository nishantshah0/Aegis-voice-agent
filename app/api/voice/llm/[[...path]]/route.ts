import { fail, ok, readObject } from "../../../_lib/http";
import { completion, completionStream, findVoiceCall, parseChatRequest, takeTurn, voiceSecretRefused } from "../../../_lib/voice-line";

// POST /api/voice/llm (any subpath, so .../v1/chat/completions and .../chat/completions land too)
// The real phone line's brain (Trail #70): ElevenLabs Agents' custom LLM, in the OpenAI Chat
// Completions shape. Needs VOICE_LLM_SECRET as a Bearer token. The newest caller words go
// through our driver (safety check, 12 buttons, speech guard); the reply holds only the guarded
// lines, streamed as server-sent events when the request asks for stream: true.
export async function POST(request: Request) {
  const refused = voiceSecretRefused(request);
  if (refused) return refused;
  const body = await readObject(request);
  if (!body) return fail(400, "Body must be a JSON object");
  const chat = parseChatRequest(body);
  if ("error" in chat) return fail(400, chat.error);
  if (process.env.VOICE_LLM_DEBUG === "1") {
    // Shapes only, never what anyone said: the path, the body's keys and the message roles.
    const roles = (body.messages as { role?: unknown }[]).map((m) => String(m?.role)).join(",");
    console.log(`voice: ${new URL(request.url).pathname} keys=${Object.keys(body).join(",")} roles=${roles} aegis_call_id=${chat.callId ?? "-"} conversation=${chat.conversationId ?? "-"} stream=${chat.stream} end_call=${chat.canEndCall}`);
  }
  const call = await findVoiceCall(chat);
  if (call instanceof Response) return call;
  const turn = takeTurn(call, chat.callerTexts);
  if (!chat.stream) return ok(await completion(turn, chat, call.callId));
  return new Response(completionStream(turn, chat, call.callId), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
