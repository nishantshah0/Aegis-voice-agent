import { fail } from "../../_lib/http";
import { signedTwilioFields } from "../../_lib/twilio";
import { endVoiceCall, voiceCall } from "../../_lib/voice-line";

const OVER = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

// POST /api/voice/twilio-status?call=<our call id>  (Twilio's status callback; Trail #70)
// When Twilio says the phone call is over, our side of the call ends too: the driver forgets it
// and the control layer records the end. Only requests Twilio signed for this exact URL.
export async function POST(request: Request) {
  const fields = await signedTwilioFields(request);
  if (!fields) return fail(403, "Not signed by Twilio");
  const call = voiceCall(new URL(request.url).searchParams.get("call") ?? "");
  if (call && OVER.has(fields.CallStatus ?? "")) await endVoiceCall(call);
  return new Response(null, { status: 204 });
}
