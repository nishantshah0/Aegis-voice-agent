import { phoneRefused } from "../../../_lib/phone";
import { fail } from "../../../_lib/http";
import { getDriver, getStore } from "../../../_lib/runtime";

// POST /api/call/:id/end → 204. Only the call's phone (or staff) can hang up.
export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/end">) {
  const { id } = await ctx.params;
  if (!(await getStore().getCall(id))) return fail(404, "No such call");
  const refused = await phoneRefused(request, id);
  if (refused) return refused;
  await getDriver().endCall(id);
  return new Response(null, { status: 204 });
}
