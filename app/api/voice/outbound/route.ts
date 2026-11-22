import { getApprover } from "@/lib/auth/session";
import { emit } from "@/lib/events";
import { IDS, PHARMACY_NAME } from "@/lib/seed";
import { conversationStatus, missingOutboundEnv, placeOutboundCall } from "../../_lib/elevenlabs-calls";
import { fail, ok } from "../../_lib/http";
import { patientsOnOpenCalls } from "../../_lib/outbound";
import { getControl, getStore } from "../../_lib/runtime";
import { endIdleVoiceCalls, endVoiceCall, linkConversation, openVoiceCall, openVoiceCalls, registerVoiceCall } from "../../_lib/voice-line";

// POST /api/voice/outbound → { callId, conversationId? }
// "Call on a real phone" (Trail #70): rings TEST_PATIENT_PHONE, the real phone that stands in for
// seed patient Sam, about Sam's Concerta. Same lock as Call now: control.startOutboundCall
// applies rule 7 (opt-in, calling hours, frequency) first. The opener is the driver's own fixed
// opening, through guardSentence, and ElevenLabs says it when Sam picks up. Signed-in
// pharmacists only, or a demo laptop with DEMO_CONTROLS=on. The number is never in a response.
export async function POST() {
  if (process.env.DEMO_CONTROLS !== "on") {
    const approver = await getApprover();
    if (!approver) return fail(401, "Sign in as a pharmacist to call a patient");
    if (approver.role !== "pharmacist") return fail(403, "Only a pharmacist can call a patient");
  }
  const missing = missingOutboundEnv();
  if (missing.length) return fail(503, `The real phone line needs ${missing.join(", ")} in .env`);

  await endFinishedCalls();
  const store = getStore();
  if ((await patientsOnOpenCalls(store)).has(IDS.sam)) return fail(409, "Sam is already on a call");
  const started = await getControl().startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) {
    return Response.json({ error: `The rules won't ring Sam now (rule ${started.ruleIds.join(", ")})`, ruleIds: started.ruleIds }, { status: 409 });
  }
  const call = registerVoiceCall(started.callId, "outbound");
  // Staff see the ring; the paired browser phone doesn't (no recordRing), so only the real phone answers.
  emit({ type: "phone", callId: call.callId, kind: "ring", text: `${PHARMACY_NAME} is calling a real phone` });
  const opening = await openVoiceCall(call);
  const placed = await placeOutboundCall(call.callId, opening.join(" "));
  if (!placed.ok) {
    await endVoiceCall(call);
    return fail(502, placed.message);
  }
  if (placed.conversationId) linkConversation(call, placed.conversationId);
  return ok({ callId: call.callId, conversationId: placed.conversationId });
}

/** Before ringing again: end our side of phone calls that ElevenLabs says are over, or went quiet. */
async function endFinishedCalls(): Promise<void> {
  await endIdleVoiceCalls();
  for (const call of openVoiceCalls()) {
    if (!call.conversationId) continue;
    const status = await conversationStatus(call.conversationId);
    if (status === "done" || status === "failed") await endVoiceCall(call);
  }
}
