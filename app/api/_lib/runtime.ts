import { createFakes } from "@/lib/contract/fakes";
import type { AgentDriver, Store } from "@/lib/contract";
import { emit } from "@/lib/events";

// The parts the API routes run on, wired once per server.
// Today: the contract's fakes. Swap one line each as the real parts land:
//   store  → lib/store/memory.ts (task 4.2)
//   driver → lib/agent (task 1.2)
// The fakes are never used to score or show a real result.

type Runtime = { store: Store; driver: AgentDriver };

const holder = globalThis as typeof globalThis & { __refillGuardRuntime?: Runtime };

function runtime(): Runtime {
  if (!holder.__refillGuardRuntime) {
    const fakes = createFakes(emit);
    holder.__refillGuardRuntime = { store: fakes.store, driver: fakes.driver };
  }
  return holder.__refillGuardRuntime;
}

export const getStore = (): Store => runtime().store;
export const getDriver = (): AgentDriver => runtime().driver;

/** Test helper: start again from fresh parts. */
export function resetRuntimeForTests(): void {
  holder.__refillGuardRuntime = undefined;
}
