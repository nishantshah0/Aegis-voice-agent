import type { CallStartResponse } from "@/lib/contract";
import { fail, ok, readObject } from "../../_lib/http";
import { getDriver } from "../../_lib/runtime";

// POST /api/call/start { direction: "inbound" } → { callId }
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
  const res: CallStartResponse = { callId: await getDriver().startCall({ direction, patientId }) };
  return ok(res, 201);
}
