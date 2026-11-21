import { fail, ok, readObject } from "../../../_lib/http";
import { callExists, getDriver } from "../../../_lib/driver";

const MAX_LINE = 2000;

// POST /api/call/:id/say { text } → { events }
// The driver emits its own events to the stream; this route only passes the
// caller's line in and returns what the driver produced for this turn.
export async function POST(request: Request, ctx: RouteContext<"/api/call/[id]/say">) {
  const { id } = await ctx.params;
  if (!callExists(id)) return fail(404, "No such call");
  const body = await readObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "Body must be { text: a non-empty string }");
  if (text.length > MAX_LINE) return fail(413, `text is longer than ${MAX_LINE} characters`);

  const events = [];
  for await (const event of getDriver().callerSays(id, text)) events.push(event);
  return ok({ events });
}
