import { connection } from "next/server";
import { DEVICE_COOKIE, claimPairing } from "../../_lib/devices";
import { fail } from "../../_lib/http";

// GET /api/phone/claim?code=… → 303 to /phone, with the httpOnly device cookie.
// The link works once; a used, expired or unknown code is a 400.
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const device = claimPairing(url.searchParams.get("code") ?? "");
  if (!device) return fail(400, "This pairing link isn't valid any more. Ask the pharmacy for a new one.");
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/phone", url).toString(),
      "Set-Cookie": `${DEVICE_COOKIE}=${device}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`,
    },
  });
}
