import { registerTwilioCall } from "../../_lib/elevenlabs-calls";
import { fail } from "../../_lib/http";
import { HANG_UP_TWIML, twilioFields, twimlResponse } from "../../_lib/twilio";
import { turnTwiml } from "../../_lib/voice-gather";
import { endVoiceCall, voiceCall } from "../../_lib/voice-line";

// POST /api/voice/twiml?call=<our call id>  (Twilio, when the outbound call connects; Trail #70)
// Only requests that carry this call's URL token (t=...) or Twilio's signature for this exact URL.
// By default (trial-safe): plays the guarded opener and starts the <Gather> turn loop
// (/api/voice/turn). With VOICE_TWILIO_STREAM=1 (a paid account): registers the call with ElevenLabs
// (register-call, our call id and the guarded opener in its init data) and hands Twilio the
// TwiML that streams it to the agent, whose only LLM is /api/voice/llm. Anything else hangs up:
// this route never speaks (<Say> would be words that didn't pass guardSentence).
export async function POST(request: Request) {
  const call = voiceCall(new URL(request.url).searchParams.get("call") ?? "");
  const fields = await twilioFields(request, call?.twimlToken);
  if (!fields) return fail(403, "Not from Twilio");
  if (!call || call.direction !== "outbound" || call.ended || call.firstMessage === undefined) return twimlResponse(HANG_UP_TWIML);
  if (process.env.VOICE_TWILIO_STREAM !== "1") {
    // Twilio may fetch this twice; the opener is voiced once and then replayed as the same TwiML.
    call.twiml ??= await turnTwiml(call, [call.firstMessage], false);
    return twimlResponse(call.twiml);
  }
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
