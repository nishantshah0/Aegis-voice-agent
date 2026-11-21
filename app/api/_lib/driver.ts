import { emit } from "@/lib/events";
import type { CallId } from "@/lib/events";

// TEMPORARY stand-in for the AgentDriver interface (docs/DESIGN.md 3.4) until
// task 0's contract and Role 1's real agent (task 1.2) land. It only starts a
// call and echoes the caller's line onto the stream; it never answers and never
// presses a button. Replacing it is one line in getDriver().

export type AgentEvent = { type: string } & Record<string, unknown>;

export interface AgentDriver {
  startCall(opts: { direction: "inbound" | "outbound"; patientId?: string }): Promise<CallId>;
  callerSays(callId: CallId, text: string): AsyncIterable<AgentEvent>;
  endCall(callId: CallId): Promise<void>;
}

const holder = globalThis as typeof globalThis & { __refillGuardCalls?: Set<CallId> };
const calls = () => (holder.__refillGuardCalls ??= new Set());

const placeholderDriver: AgentDriver = {
  async startCall() {
    const callId = `call_${crypto.randomUUID()}`;
    calls().add(callId);
    return callId;
  },
  async *callerSays(callId, text) {
    emit({ type: "line", callId, who: "caller", text });
  },
  async endCall(callId) {
    calls().delete(callId);
  },
};

export function getDriver(): AgentDriver {
  return placeholderDriver;
}

/** Whether a call was started on this server. The real store replaces this. */
export function callExists(callId: CallId): boolean {
  return calls().has(callId);
}
