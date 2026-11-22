import { first, nextFlow, type Flow } from "../phone/flow";
import { AgentUnavailable, agentEnabled, agentSilence, agentTurn, endAgentCall, openAgent, type AgentReply, type Channel } from "./agent";

// One presenter turn, phone or browser (Trail #70): the real agent when it's available, the
// scripted menu otherwise. A call that falls back stays on the menu (from its PIN step) and the
// presenter screen says "fallback".

/** Said before the menu's own first prompt when the agent can't continue. Fixed, like the menu's lines. */
export const FALLBACK_LINE = "The assistant is unavailable right now, so I'll use the demo menu instead. ";

const TIMEOUT_MS = { phone: 8000, browser: 20000 } as const; // Twilio waits at most 15 s, voice included

export type { Channel };
export type Assistant = "agent" | "fallback" | "menu";

export const assistantOf = (flow: Flow): Assistant => flow.mode ?? "menu";

async function fallback(reason: unknown, flow?: Flow): Promise<Flow> {
  // The reason only (rules, caps, timeouts, model errors), never what anyone said.
  const kind = reason instanceof AgentUnavailable ? "unavailable" : "error";
  console.warn(`presenter agent: falling back to the menu (${kind}: ${reason instanceof Error ? reason.message : "unknown"})`);
  if (flow?.agent) await endAgentCall(flow.agent.callId);
  return { ...first, mode: "fallback", reply: FALLBACK_LINE + first.reply };
}

const withReply = (flow: Flow, r: AgentReply): Flow => ({
  ...flow,
  agent: r.agent,
  reply: r.reply,
  verified: r.verified,
  requested: r.refillRequested,
  codeSent: r.codeSent,
  ...(r.inbound ? { callKind: "inbound" as const, notice: r.inbound.reason } : {}),
  phase: r.ended ? "end" : "agent",
});

/** The first flow of a new presenter call: the agent's guarded opener, or the menu. */
export async function openFlow(id: string, channel: Channel): Promise<Flow> {
  if (!agentEnabled()) return first;
  try {
    const opened = await openAgent(id, channel);
    return withReply({ ...first, mode: "agent", callKind: "outbound" }, opened);
  } catch (error) {
    return fallback(error);
  }
}

/** The next flow after the caller's speech (or keypad digits). */
export async function nextTurn(id: string, flow: Flow, digits: string, speech: string, channel: Channel): Promise<Flow> {
  if (flow.mode !== "agent" || !flow.agent) return nextFlow(id, flow, digits, speech);
  if (flow.phase === "end") return flow;
  const text = speech.trim() || (digits ? `My code is ${digits.split("").join(" ")}.` : "");
  try {
    const wasVerified = flow.verified;
    const reply = text
      ? await agentTurn(id, flow.agent, text, { channel, timeoutMs: TIMEOUT_MS[channel], wasVerified })
      : await agentSilence(id, flow.agent, { channel, wasVerified });
    return withReply(flow, reply);
  } catch (error) {
    return fallback(error, flow);
  }
}
