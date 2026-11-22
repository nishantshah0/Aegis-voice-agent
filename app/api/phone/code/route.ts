import { connection } from "next/server";
import { devicePatient } from "../../_lib/devices";
import { fail, ok } from "../../_lib/http";
import { codeForDevice } from "../../_lib/voice-line";

// GET /api/phone/code → { code } or 204   (Trail #70)
// The "phone on file" for a real phone call: when the code couldn't be texted, the patient's
// paired /phone page shows it. Only that device, by its pairing cookie; not staff, not anyone
// else. The code comes from control.codeFor, so it expires and locks out like any other code.
export async function GET(request: Request) {
  await connection();
  const patientId = devicePatient(request);
  if (!patientId) return fail(401, "Only a paired phone can read its codes");
  const code = await codeForDevice(patientId);
  return code ? ok({ code }) : new Response(null, { status: 204 });
}
