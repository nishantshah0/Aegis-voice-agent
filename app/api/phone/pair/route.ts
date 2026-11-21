import { getApprover } from "@/lib/auth/session";
import { createPairing } from "../../_lib/devices";
import { fail, ok, readObject } from "../../_lib/http";
import { getStore } from "../../_lib/runtime";

// POST /api/phone/pair { patientId } → { url, expiresAt }
// Signed-in staff only. Open `url` on the patient's phone once, within 10 minutes, to pair it.
export async function POST(request: Request) {
  if (!(await getApprover())) return fail(401, "Sign in to pair a phone");
  const body = await readObject(request);
  const patientId = typeof body?.patientId === "string" ? body.patientId : "";
  if (!patientId || !(await getStore().getPatient(patientId))) return fail(404, "No such patient");
  const { code, expiresAt } = createPairing(patientId);
  return ok({ url: `/api/phone/claim?code=${code}`, expiresAt });
}
