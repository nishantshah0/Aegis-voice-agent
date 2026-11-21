import type { Delivered, StreamEvent } from "./types";

const HELLO_TIMEOUT_MS = 4_000;
const POLL_MS = 1_000;

/**
 * Browser helper for pages that listen to the server's events.
 * Uses the /api/events stream. If its "hello" doesn't arrive within a few seconds (some
 * hosts, like Cloudflare quick tunnels, hold server-sent events back), it closes the
 * stream and polls /api/events/poll once a second instead. Same events either way.
 * Returns the function that stops listening.
 */
export function listenToEvents(onEvent: (event: StreamEvent, id: number) => void): () => void {
  let stopped = false;
  let helloSeen = false;
  let lastId: number | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const deliver = (event: StreamEvent, id: number) => {
    lastId = id;
    try {
      onEvent(event, id);
    } catch {
      // A page's handler failing must not stop the feed.
    }
  };

  const source = new EventSource("/api/events");
  source.addEventListener("hello", () => {
    helloSeen = true;
  });
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
      const res = await fetch(lastId === null ? "/api/events/poll" : `/api/events/poll?after=${lastId}`);
      if (res.ok) {
        const body = (await res.json()) as { events: Delivered[]; last: number };
        for (const d of body.events) deliver(d.event, d.id);
        lastId = Math.max(lastId ?? 0, body.last);
      }
    } catch {
      // Try again on the next tick.
    }
    if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
  }

  const fallback = setTimeout(() => {
    if (helloSeen || stopped) return;
    source.close();
    void poll();
  }, HELLO_TIMEOUT_MS);

  return () => {
    stopped = true;
    clearTimeout(fallback);
    clearTimeout(pollTimer);
    source.close();
  };
}
