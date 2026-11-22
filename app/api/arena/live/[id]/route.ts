import { refuseUnlessStaff } from "../../../_lib/arena-runs";
import { fail, ok } from "../../../_lib/http";
import { readLiveCall } from "../../../_lib/live-calls";

// GET /api/arena/live/:id → the live call so far (or as saved): its turns with their times,
// the phone line, and the verdict once it ends. Staff only. The page polls this.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  const { id } = await ctx.params;
  const call = await readLiveCall(id);
  return call ? ok(call) : fail(404, "No such live call");
}
