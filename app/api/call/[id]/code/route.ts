import { connection } from "next/server";
import { codeRefused } from "../../../_lib/phone";
import { fail, ok } from "../../../_lib/http";
import { getControl } from "../../../_lib/runtime";

// GET /api/call/:id/code → { code }
// The verification code for one call, for that call's phone page. Codes never go on the
// public event stream (Trail #3). Only the call's own phone, by its x-phone-token, may read
// it: not staff, and not DEMO_CONTROLS (Trail #3, second review).
export async function GET(request: Request, ctx: RouteContext<"/api/call/[id]/code">) {
  await connection();
  const { id } = await ctx.params;
  const refused = await codeRefused(request, id);
  if (refused) return refused;
  const code = await getControl().codeFor(id);
  return code ? ok({ code }) : fail(404, "No code for this call");
}
