import { createFakeDriver, createFakeGuard } from "@/lib/contract/fakes";
import type { AgentDriver, Store } from "@/lib/contract";
import { emit } from "@/lib/events";
import { SEED } from "@/lib/seed";
import { getStore as getServerStore } from "@/lib/store/memory";

// The parts the API routes run on, wired once per server.
// Store: Role 4's in-memory store (4.2), shared with every other part of the server.
// Driver: the contract's fake until Role 1's agent lands (1.2); swap that one line.
// The fake driver is never used to score or show a real result.

const holder = globalThis as typeof globalThis & { __refillGuardDriver?: AgentDriver };

export const getStore = (): Store => getServerStore();

export function getDriver(): AgentDriver {
  holder.__refillGuardDriver ??= createFakeDriver(getStore(), createFakeGuard(getStore(), emit), emit);
  return holder.__refillGuardDriver;
}

/** Test helper: reseed the store and start a fresh driver. */
export async function resetRuntimeForTests(): Promise<void> {
  await getStore().reset(SEED);
  holder.__refillGuardDriver = undefined;
}
