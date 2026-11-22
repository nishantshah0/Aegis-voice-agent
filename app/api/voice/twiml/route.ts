import { registerTwilioCall } from "../../_lib/elevenlabs-calls";
import { fail } from "../../_lib/http";
import { HANG_UP_TWIML, twilioFields, twimlResponse } from "../../_lib/twilio";
import { endVoiceCall, voiceCall } from "../../_lib/voice-line";

// POST /api/voice/twiml?call=<our call id>  (Twilio, when the outbound call connects; Trail #70)
// Only requests that carry this call's URL token (t=...) or Twilio's signature for this exact URL.
// Registers the call with ElevenLabs
// (register-call, our call id and the guarded opener in its init data) and hands Twilio the
// TwiML that streams it to the agent, whose only LLM is /api/voice/llm. Anything else hangs up:
// this route never speaks (<Say> would be words that didn't pass guardSentence).
export async function POST(request: Request) {
  const call = voiceCall(new URL(request.url).searchParams.get("call") ?? "");
  const fields = await twilioFields(request, call?.twimlToken);
  if (!fields) return fail(403, "Not from Twilio");
  if (!call || call.direction !== "outbound" || call.ended || call.firstMessage === undefined) return twimlResponse(HANG_UP_TWIML);
  if (call.twiml) return twimlResponse(call.twiml);
  const registered = await registerTwilioCall(call.callId, call.firstMessage, process.env.TWILIO_PHONE_NUMBER!, process.env.TEST_PATIENT_PHONE!);
  if (!registered.ok) {
    console.warn(`voice: ElevenLabs register-call answered ${registered.status} for ${call.callId}`);
    await endVoiceCall(call);
    return twimlResponse(HANG_UP_TWIML);
  }
  call.twiml = registered.twiml;
  return twimlResponse(registered.twiml);
}
