import { createFakeDriver, createFakeGuard } from "@/lib/contract/fakes";
import type { AgentDriver, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { emit } from "@/lib/events";
import { SEED } from "@/lib/seed";
import { getStore as getServerStore } from "@/lib/store/memory";

// The parts the API routes run on, wired once per server.
// Store: Role 4's in-memory store (4.2), shared with every other part of the server.
// Control: Role 4's control layer (4.3) on that store. Every call starts through it (rule 7).
// Driver: the contract's fake until Role 1's agent lands (1.2); swap that one line.
// The fake driver is never used to score or show a real result.

type Parts = { control: Control; driver: AgentDriver };

const holder = globalThis as typeof globalThis & { __refillGuardParts?: Parts };

export const getStore = (): Store => getServerStore();

function parts(): Parts {
  if (!holder.__refillGuardParts) {
    const store = getStore();
    const control = createControl({ store, emit });
    const fake = createFakeDriver(store, createFakeGuard(store, emit), emit);
    // Calls start through the control layer, never the fake's own startCall.
    const driver: AgentDriver = { ...fake, startCall: (opts) => control.startCall(opts) };
    holder.__refillGuardParts = { control, driver };
  }
  return holder.__refillGuardParts;
}

export const getControl = (): Control => parts().control;
export const getDriver = (): AgentDriver => parts().driver;

/** Test helper: reseed the store and start fresh parts. */
export async function resetRuntimeForTests(): Promise<void> {
  await getStore().reset(SEED);
  holder.__refillGuardParts = undefined;
}
