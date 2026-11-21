import { connection } from "next/server";
import { createEventStream, parseLastEventId } from "@/lib/events/sse";

// GET /api/events: server-sent events. One message per StreamEvent, JSON in
// `data`, a rising number in `id`. Reconnecting pages resume from Last-Event-ID.
export async function GET(request: Request) {
  await connection(); // Never prerender: this response is live.
  const afterId = parseLastEventId(request.headers.get("last-event-id"));
  return new Response(createEventStream(request.signal, afterId), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
