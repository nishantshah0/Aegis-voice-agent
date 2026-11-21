import type { StreamEvent } from "./types";

/**
 * Browser helper for pages that listen to /api/events.
 * Calls `onEvent` for every event and reconnects on its own (EventSource does).
 * Returns the function that stops listening.
 */
export function listenToEvents(onEvent: (event: StreamEvent, id: number) => void): () => void {
  const source = new EventSource("/api/events");
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as StreamEvent, Number(message.lastEventId));
    } catch {
      // Ignore a malformed frame rather than breaking the page.
    }
  };
  return () => source.close();
}
