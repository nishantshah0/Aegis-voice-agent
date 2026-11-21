import { fail, ok, readObject } from "../../_lib/http";
import { getDriver } from "../../_lib/driver";

// POST /api/call/start { direction: "inbound" | "outbound", patientId? } → { callId }
export async function POST(request: Request) {
  const body = await readObject(request);
  const direction = body?.direction;
  const patientId = body?.patientId;
  if (direction !== "inbound" && direction !== "outbound") {
    return fail(400, 'direction must be "inbound" or "outbound"');
  }
  if (patientId !== undefined && typeof patientId !== "string") {
    return fail(400, "patientId must be a string when given");
  }
  const callId = await getDriver().startCall({ direction, patientId });
  return ok({ callId }, 201);
}
