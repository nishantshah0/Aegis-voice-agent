import { eventsSince, subscribe } from "./bus";
import type { Delivered, StreamEvent } from "./types";

/**
 * What may go on the public stream. Verification codes never do (review finding, Trail #3):
 * the phone reads its code from GET /api/call/:id/code instead.
 */
export function isPublic(event: StreamEvent): boolean {
  return !(event.type === "phone" && event.kind === "code");
}

const HEARTBEAT_MS = 15_000;
const RETRY_MS = 2_000;

const encoder = new TextEncoder();

/** One server-sent event: `id`, then the StreamEvent as JSON on one data line. */
export function sseFrame(delivered: Delivered): string {
  return `id: ${delivered.id}\ndata: ${JSON.stringify(delivered.event)}\n\n`;
}

/** Parse the Last-Event-ID header. Anything unusable means "start from now". */
export function parseLastEventId(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * A stream of every emitted event, closed when `signal` aborts.
 * With `afterId`, events still in the replay buffer after that id are sent first.
 */
export function createEventStream(signal: AbortSignal, afterId: number | null): ReadableStream<Uint8Array> {
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSent = afterId ?? 0;
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const deliver = (d: Delivered) => {
        if (d.id <= lastSent) return;
        lastSent = d.id;
        if (isPublic(d.event)) send(sseFrame(d));
      };

      // Subscribe before replaying, so nothing emitted in between is lost.
      const unsubscribe = subscribe(deliver);
      send(`retry: ${RETRY_MS}\n: connected\n\n`);
      if (afterId !== null) eventsSince(afterId).forEach(deliver);

      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    },
    cancel() {
      cleanup();
    },
  });
}
