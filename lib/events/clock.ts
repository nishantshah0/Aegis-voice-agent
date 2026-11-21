import { emit } from "./bus";

// The demo clock. Until it is set (POST /api/clock, or demo reset in task 2.2)
// it follows real time. Once set, it stays at that moment until set again.

const holder = globalThis as typeof globalThis & { __refillGuardClock?: string | null };

/** The demo clock's current time as an ISO string. */
export function now(): string {
  return holder.__refillGuardClock ?? new Date().toISOString();
}

/** Set the demo clock and tell every page. Returns the normalised ISO time. */
export function setClock(iso: string): string {
  const normalised = new Date(iso).toISOString();
  holder.__refillGuardClock = normalised;
  emit({ type: "clock", now: normalised });
  return normalised;
}

/** Test helper: go back to real time. */
export function resetClockForTests(): void {
  holder.__refillGuardClock = null;
}
