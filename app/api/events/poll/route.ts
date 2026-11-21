import { connection } from "next/server";
import { eventsSince, lastId } from "@/lib/events/bus";
import { isPublic } from "@/lib/events/sse";
import { fail, ok } from "../../_lib/http";

// GET /api/events/poll?after=<id> → { events: [{ id, event }], last }
// The same public events as /api/events, for hosts that won't carry a stream (Cloudflare
// quick tunnels don't support server-sent events). Without `after`, it starts from now.
export async function GET(request: Request) {
  await connection();
  const raw = new URL(request.url).searchParams.get("after");
  if (raw === null) return ok({ events: [], last: lastId() });
  const after = Number(raw);
  if (!Number.isInteger(after) || after < 0) return fail(400, "after must be a whole number");
  return ok({ events: eventsSince(after).filter((d) => isPublic(d.event)), last: lastId() });
}
