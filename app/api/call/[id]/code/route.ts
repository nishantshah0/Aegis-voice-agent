import { connection } from "next/server";
import { demoControlsRefused } from "../../../_lib/demo";
import { fail, ok } from "../../../_lib/http";
import { getControl } from "../../../_lib/runtime";

// GET /api/call/:id/code → { code }
// The verification code for one call, for that call's phone page. Codes never go on the
// public event stream (Trail #3). Until the phone page has its own per-call token, this
// needs a signed-in pharmacist or reviewer, or DEMO_CONTROLS=on on the demo laptop.
export async function GET(_request: Request, ctx: RouteContext<"/api/call/[id]/code">) {
  await connection();
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const { id } = await ctx.params;
  const code = await getControl().codeFor(id);
  return code ? ok({ code }) : fail(404, "No code for this call");
}
