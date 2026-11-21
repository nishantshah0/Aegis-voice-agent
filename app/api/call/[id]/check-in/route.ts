import { checkInCall, phoneRefused } from "../../../_lib/phone";
import { fail, ok } from "../../../_lib/http";
import { getDriver, getStore } from "../../../_lib/runtime";

// POST /api/call/:id/check-in → { events } or 204
// After a silence the phone asks the driver to check in ("Are you still there?"). Same
// token rule as say. 204 when the driver has no check-in (the contract's fake).
export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/check-in">) {
  const { id } = await ctx.params;
  if (!(await getStore().getCall(id))) return fail(404, "No such call");
  const refused = await phoneRefused(request, id);
  if (refused) return refused;
  const events = await checkInCall(getDriver(), id);
  return events ? ok({ events }) : new Response(null, { status: 204 });
}
