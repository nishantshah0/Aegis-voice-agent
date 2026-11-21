import { getApprover } from "@/lib/auth/session";
import type { Audience } from "@/lib/events/audience";
import { fail } from "./http";
import { devicePatient, ringTarget } from "./devices";
import { tokenMatches } from "./phone";

/**
 * Who is listening to /api/events or /api/events/poll: signed-in staff, a call's phone
 * (?call=<id>&token=<phone token>; EventSource can't send headers), or the public.
 * A wrong token is a 403 rather than a quiet downgrade, so a broken phone page shows up.
 */
export async function resolveAudience(request: Request): Promise<Audience | Response> {
  if (await getApprover()) return { kind: "staff" };
  const params = new URL(request.url).searchParams;
  const callId = params.get("call");
  const token = params.get("token");
  if (callId || token) {
    return callId && tokenMatches(callId, token) ? { kind: "phone", callId } : fail(403, "That token isn't for this call");
  }
  const patientId = devicePatient(request);
  if (patientId) return { kind: "device", patientId, ringTarget };
  return { kind: "public" };
}
