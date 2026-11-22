import { fail } from "../../_lib/http";
import { HANG_UP_TWIML, twilioFields, twimlResponse } from "../../_lib/twilio";
import { fillerTwiml, turnTwiml } from "../../_lib/voice-gather";
import { VOICE_MAX_LINE, doneWithin, endVoiceCall, finishTurn, takeTurn, voiceCall } from "../../_lib/voice-line";

/** How long the agent may think before the caller hears the filler line. */
const fillerAfterMs = () => Number(process.env.VOICE_FILLER_MS ?? 1200);

// POST /api/voice/turn?call=<id>&t=<token>[&quiet=1|&cont=1]  (Twilio, after each <Gather>; Trail #70)
// What Twilio heard (SpeechResult) goes to the same takeTurn as every other call: the safety
// check, the 12 buttons through control.press, and guardSentence. The answer is TwiML that plays
// only the driver's guarded lines and listens again. A first silence gets the driver's check-in;
// a second one hangs up. Only this call's URL token, or Twilio's signature, gets in.
// A slow turn first answers with the guarded filler line and a Redirect to `cont=1`, which waits
// for the same turn and plays its answer (nothing new is heard on that request).
export async function POST(request: Request) {
  const url = new URL(request.url);
  const call = voiceCall(url.searchParams.get("call") ?? "");
  const fields = await twilioFields(request, call?.twimlToken);
  if (!fields || !call) return fail(403, "Not from Twilio");
  if (call.ended) return twimlResponse(HANG_UP_TWIML);
  call.lastSeen = Date.now();

  const resumed = url.searchParams.get("cont") === "1";
  if (!resumed) {
    const heard = (fields.SpeechResult ?? "").trim().slice(0, VOICE_MAX_LINE);
    if (heard && url.searchParams.get("quiet") !== "1") {
      call.quiet = 0;
      call.heard.push(heard);
    } else if (++call.quiet >= 2) {
      await endVoiceCall(call);
      return twimlResponse(HANG_UP_TWIML);
    }
  }
  // A silence asks again with nothing new, which takeTurn answers with the driver's check-in.
  // A resumed request asks again with nothing new while the turn runs, which returns that turn.
  const current = takeTurn(call, call.heard);
  if (!resumed && !(await doneWithin(current, fillerAfterMs()))) {
    const filler = await fillerTwiml(call);
    if (filler) return twimlResponse(filler);
  }
  const { lines, ended } = await finishTurn(current);
  if (ended) await endVoiceCall(call);
  return twimlResponse(await turnTwiml(call, lines, ended));
}
