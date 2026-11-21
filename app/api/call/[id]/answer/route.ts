import type { AgentEvent, CallId } from "@/lib/contract";
import { devicePatient } from "../../../_lib/devices";
import { answerCall, issuePhoneToken } from "../../../_lib/phone";
import { fail, ok } from "../../../_lib/http";
import { getDriver, getStore } from "../../../_lib/runtime";

export type CallAnswerResponse = { callId: CallId; phoneToken: string; events: AgentEvent[] };

// POST /api/call/:id/answer → { callId, phoneToken, events }
// The phone picks up. The first answer gets the call's phone token; any later one gets 409.
// Outbound calls need the patient's paired device (see app/api/_lib/devices.ts).
// The driver joins the call (outbound) and plays its fixed opening.
export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/answer">) {
  const { id } = await ctx.params;
  const call = await getStore().getCall(id);
  if (!call) return fail(404, "No such call");
  if (call.state === "ended") return fail(409, "This call has ended");
  // An outbound call is answered only by the patient's paired phone (Trail #19).
  if (call.direction === "outbound") {
    const patient = devicePatient(request);
    if (!patient) return fail(401, "Only the patient's paired phone can answer this call");
    if (patient !== call.targetPatientId) return fail(403, "This phone is paired to someone else");
  }
  const phoneToken = issuePhoneToken(id);
  if (!phoneToken) return fail(409, "This call was already answered");
  const res: CallAnswerResponse = { callId: id, phoneToken, events: await answerCall(getDriver(), getStore(), id) };
  return ok(res);
}
