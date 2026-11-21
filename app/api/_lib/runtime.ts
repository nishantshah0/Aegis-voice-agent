import { createAgentDriver, createClaudeModel } from "@/lib/agent";
import { createFakeDriver, createFakeGuard } from "@/lib/contract/fakes";
import type { AgentDriver, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { PHARMACY_NAME, SEED } from "@/lib/seed";
import { getStore as getServerStore } from "@/lib/store/memory";
import { clearPhoneTokens } from "./phone";

// The parts the API routes run on, wired once per server.
// Store: Role 4's in-memory store (4.2), shared with every other part of the server.
// Control: Role 4's control layer (4.3) on that store. Every call starts through it (rule 7).
// Driver: Role 1's real agent (1.2) when ANTHROPIC_API_KEY is in the server's .env, with the
// real speech guard and safety check; otherwise the contract's fake, which never scores or
// shows a real result.

type Parts = { control: Control; driver: AgentDriver };

const holder = globalThis as typeof globalThis & { __refillGuardParts?: Parts };

export const getStore = (): Store => getServerStore();

function parts(): Parts {
  if (!holder.__refillGuardParts) {
    const store = getStore();
    // Codes never go on the event stream; the phone reads them from GET /api/call/:id/code.
    const control = createControl({ store, emit, broadcastCodes: false });
    holder.__refillGuardParts = { control, driver: makeDriver(store, control) };
  }
  return holder.__refillGuardParts;
}

function makeDriver(store: Store, control: Control): AgentDriver {
  if (process.env.ANTHROPIC_API_KEY) {
    return createAgentDriver({
      calls: control,
      press: control.press,
      guardSentence: createSpeechGuard({ store, emit }),
      checkCallerLine: createSafetyCheck({ store, emit }),
      model: createClaudeModel(),
      pharmacyName: PHARMACY_NAME,
      emit,
    });
  }
  const fake = createFakeDriver(store, createFakeGuard(store, emit), emit);
  // Calls start through the control layer, never the fake's own startCall.
  return { ...fake, startCall: (opts) => control.startCall(opts) };
}

export const getControl = (): Control => parts().control;
export const getDriver = (): AgentDriver => parts().driver;

/** Test helper: reseed the store and start fresh parts. */
export async function resetRuntimeForTests(): Promise<void> {
  await getStore().reset(SEED);
  clearPhoneTokens();
  holder.__refillGuardParts = undefined;
}
