import { fail } from "../../_lib/http";
import { HANG_UP_TWIML, twilioFields, twimlResponse } from "../../_lib/twilio";
import { turnTwiml } from "../../_lib/voice-gather";
import { VOICE_MAX_LINE, endVoiceCall, finishTurn, takeTurn, voiceCall } from "../../_lib/voice-line";

// POST /api/voice/turn?call=<id>&t=<token>[&quiet=1]  (Twilio, after each <Gather>; Trail #70)
// What Twilio heard (SpeechResult) goes to the same takeTurn as every other call: the safety
// check, the 12 buttons through control.press, and guardSentence. The answer is TwiML that plays
// only the driver's guarded lines and listens again. A first silence gets the driver's check-in;
// a second one hangs up. Only this call's URL token, or Twilio's signature, gets in.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const call = voiceCall(url.searchParams.get("call") ?? "");
  const fields = await twilioFields(request, call?.twimlToken);
  if (!fields || !call) return fail(403, "Not from Twilio");
  if (call.ended) return twimlResponse(HANG_UP_TWIML);
  call.lastSeen = Date.now();

  const heard = (fields.SpeechResult ?? "").trim().slice(0, VOICE_MAX_LINE);
  if (heard && url.searchParams.get("quiet") !== "1") {
    call.quiet = 0;
    call.heard.push(heard);
  } else if (++call.quiet >= 2) {
    await endVoiceCall(call);
    return twimlResponse(HANG_UP_TWIML);
  }
  // A silence asks again with nothing new, which takeTurn answers with the driver's check-in.
  const { lines, ended } = await finishTurn(takeTurn(call, call.heard));
  if (ended) await endVoiceCall(call);
  return twimlResponse(await turnTwiml(call, lines, ended));
}
