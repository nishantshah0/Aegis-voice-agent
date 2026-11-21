import { connection } from "next/server";
import { forAudience } from "@/lib/events/audience";
import { createEventStream, parseLastEventId } from "@/lib/events/sse";
import { resolveAudience } from "../_lib/audience";

// GET /api/events[?call=<id>&token=<phone token>]: server-sent events. One message per
// StreamEvent, JSON in `data`, a rising number in `id`; reconnects resume from Last-Event-ID.
// What each listener gets depends on who it is (lib/events/audience.ts).
export async function GET(request: Request) {
  await connection(); // Never prerender: this response is live.
  const audience = await resolveAudience(request);
  if (audience instanceof Response) return audience;
  const afterId = parseLastEventId(request.headers.get("last-event-id"));
  return new Response(createEventStream(request.signal, afterId, (event) => forAudience(event, audience)), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
