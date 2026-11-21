import type { AgentEvent, CallSayResponse } from "@/lib/contract";
import { fail, ok, readObject } from "../../../_lib/http";
import { getDriver, getStore } from "../../../_lib/runtime";
import { phoneRefused } from "../../../_lib/phone";

const MAX_LINE = 2000;

// POST /api/call/:id/say { text } → { events }. Needs the call's x-phone-token (or staff).
// The driver emits its own events to the stream; this route only passes the
// caller's line in and returns what the driver produced for this turn.
export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/say">) {
  const { id } = await ctx.params;
  if (!(await getStore().getCall(id))) return fail(404, "No such call");
  const refused = await phoneRefused(request, id);
  if (refused) return refused;
  const body = await readObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "Body must be { text: a non-empty string }");
  if (text.length > MAX_LINE) return fail(413, `text is longer than ${MAX_LINE} characters`);

  const events: AgentEvent[] = [];
  for await (const event of getDriver().callerSays(id, text)) events.push(event);
  const res: CallSayResponse = { events };
  return ok(res);
}
