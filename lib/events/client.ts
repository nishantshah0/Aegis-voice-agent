import type { Delivered, StreamEvent } from "./types";

const HELLO_TIMEOUT_MS = 4_000;
const POLL_MS = 1_000;

export type EventConnection = "connecting" | "connected" | "recovering";

/**
 * Browser helper for pages that listen to the server's events.
 * Uses the /api/events stream. If its "hello" doesn't arrive within a few seconds (some
 * hosts, like Cloudflare quick tunnels, hold server-sent events back), it closes the
 * stream and polls /api/events/poll once a second instead. Same events either way.
 * Returns the function that stops listening.
 */
export function listenToEvents(
  onEvent: (event: StreamEvent, id: number) => void,
  phone?: { callId: string; token: string },
  onConnection?: (state: EventConnection) => void,
): () => void {
  // A phone listens to its own call with its token; staff are recognised by their sign-in.
  const query = phone ? `call=${encodeURIComponent(phone.callId)}&token=${encodeURIComponent(phone.token)}` : "";
  let stopped = false;
  let helloSeen = false;
  let connection: EventConnection | undefined;
  let lastId: number | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const report = (state: EventConnection) => {
    if (stopped || connection === state) return;
    connection = state;
    onConnection?.(state);
  };

  const deliver = (event: StreamEvent, id: number) => {
    lastId = id;
    try {
      onEvent(event, id);
    } catch {
      // A page's handler failing must not stop the feed.
    }
  };

  const source = new EventSource(query ? `/api/events?${query}` : "/api/events");
  report("connecting");
  source.addEventListener("hello", () => {
    helloSeen = true;
    report("connected");
  });
  source.onerror = () => report("recovering");
  source.onmessage = (message) => {
    try {
      deliver(JSON.parse(message.data) as StreamEvent, Number(message.lastEventId));
    } catch {
      // Ignore a malformed frame rather than breaking the page.
    }
  };

  async function poll() {
    if (stopped) return;
    try {
      const params = [lastId === null ? "" : `after=${lastId}`, query].filter(Boolean).join("&");
      const res = await fetch(params ? `/api/events/poll?${params}` : "/api/events/poll");
      if (stopped) return;
      if (res.ok) {
        const body = (await res.json()) as { events: Delivered[]; last: number };
        if (stopped) return;
        for (const d of body.events) deliver(d.event, d.id);
        lastId = Math.max(lastId ?? 0, body.last);
        report("connected");
      } else {
        report("recovering");
      }
    } catch {
      report("recovering");
    }
    if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
  }

  const fallback = setTimeout(() => {
    if (helloSeen || stopped) return;
    source.close();
    report("recovering");
    void poll();
  }, HELLO_TIMEOUT_MS);

  return () => {
    stopped = true;
    clearTimeout(fallback);
    clearTimeout(pollTimer);
    source.close();
  };
}
