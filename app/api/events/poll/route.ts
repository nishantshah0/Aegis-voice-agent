import { connection } from "next/server";
import { forAudience } from "@/lib/events/audience";
import { eventsSince, lastId } from "@/lib/events/bus";
import type { Delivered } from "@/lib/events/types";
import { resolveAudience } from "../../_lib/audience";
import { fail, ok } from "../../_lib/http";

// GET /api/events/poll?after=<id>[&call=<id>&token=<phone token>] → { events, last }
// The same events as /api/events, for hosts that won't carry a stream (Cloudflare quick
// tunnels don't support server-sent events), shaped for the same audience. Without
// `after`, it starts from now.
export async function GET(request: Request) {
  await connection();
  const audience = await resolveAudience(request);
  if (audience instanceof Response) return audience;
  const raw = new URL(request.url).searchParams.get("after");
  if (raw === null) return ok({ events: [], last: lastId() });
  const after = Number(raw);
  if (!Number.isInteger(after) || after < 0) return fail(400, "after must be a whole number");
  const events = eventsSince(after).flatMap((d): Delivered[] => {
    const shaped = forAudience(d.event, audience);
    return shaped ? [{ id: d.id, event: shaped }] : [];
  });
  return ok({ events, last: lastId() });
}
