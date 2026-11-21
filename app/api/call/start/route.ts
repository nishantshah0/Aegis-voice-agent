import type { CallStartResponse } from "@/lib/contract";
import { fail, ok, readObject } from "../../_lib/http";
import { getDriver } from "../../_lib/runtime";
import { issuePhoneToken } from "../../_lib/phone";

// POST /api/call/start { direction: "inbound" } → { callId, phoneToken }
// Outbound calls only start from POST /api/outbound/run-daily-check, through rule 7.
export async function POST(request: Request) {
  const body = await readObject(request);
  const direction = body?.direction;
  const patientId = body?.patientId;
  if (direction !== "inbound" && direction !== "outbound") {
    return fail(400, 'direction must be "inbound" or "outbound"');
  }
  if (direction === "outbound") {
    return fail(400, "Outbound calls start from POST /api/outbound/run-daily-check (rule 7)");
  }
  if (patientId !== undefined && typeof patientId !== "string") {
    return fail(400, "patientId must be a string when given");
  }
  const callId = await getDriver().startCall({ direction, patientId });
  // The phone that started the call gets its token (see app/api/_lib/phone.ts).
  const res: CallStartResponse & { phoneToken: string } = { callId, phoneToken: issuePhoneToken(callId)! };
  return ok(res, 201);
}
