import type { Delivered, StreamEvent } from "./types";

// One in-process bus for the whole server. Every role calls emit(); the
// /api/events route subscribes and forwards to pages. A short replay buffer
// lets a page that reconnects (EventSource sends Last-Event-ID) catch up.

const REPLAY_SIZE = 200;

type Listener = (delivered: Delivered) => void;

type Bus = { nextId: number; recent: Delivered[]; listeners: Set<Listener> };

// Kept on globalThis so every route module (and dev hot reloads) share one bus.
const holder = globalThis as typeof globalThis & { __refillGuardBus?: Bus };

function bus(): Bus {
  holder.__refillGuardBus ??= { nextId: 1, recent: [], listeners: new Set() };
  return holder.__refillGuardBus;
}

/** Send an event to every open page. Never throws to the caller. */
export function emit(event: StreamEvent): Delivered {
  const b = bus();
  const delivered: Delivered = { id: b.nextId++, event };
  b.recent.push(delivered);
  if (b.recent.length > REPLAY_SIZE) b.recent.shift();
  for (const listener of b.listeners) {
    try {
      listener(delivered);
    } catch {
      // A broken listener must not stop the others or the emitter.
    }
  }
  return delivered;
}

/** Listen to every event from now on. Returns the function that stops listening. */
export function subscribe(listener: Listener): () => void {
  const b = bus();
  b.listeners.add(listener);
  return () => b.listeners.delete(listener);
}

/** Events still in the replay buffer with an id greater than `afterId`. */
export function eventsSince(afterId: number): Delivered[] {
  return bus().recent.filter((d) => d.id > afterId);
}

/** Test helper: forget all events and listeners. */
export function resetBusForTests(): void {
  holder.__refillGuardBus = undefined;
}
