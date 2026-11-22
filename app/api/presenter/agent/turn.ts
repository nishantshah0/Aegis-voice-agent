import { first, nextFlow, type Flow } from "../phone/flow";
import { AgentUnavailable, agentEnabled, agentSilence, agentTurn, openAgent, type AgentReply } from "./agent";

// One presenter turn, phone or browser (Trail #70): the real agent when it's available, the
// scripted menu otherwise. A call that falls back stays on the menu (from its PIN step) and the
// presenter screen says "fallback".

/** Said before the menu's own first prompt when the agent can't continue. Fixed, like the menu's lines. */
export const FALLBACK_LINE = "The assistant is unavailable right now, so I'll use the demo menu instead. ";

const TIMEOUT_MS = { phone: 8000, browser: 20000 } as const; // Twilio waits at most 15 s, voice included

export type Channel = keyof typeof TIMEOUT_MS;
export type Assistant = "agent" | "fallback" | "menu";

export const assistantOf = (flow: Flow): Assistant => flow.mode ?? "menu";

function fallback(reason: unknown): Flow {
  if (!(reason instanceof AgentUnavailable)) console.warn(`presenter agent: ${reason instanceof Error ? reason.message : "unknown error"}`);
  return { ...first, mode: "fallback", reply: FALLBACK_LINE + first.reply };
}

const withReply = (flow: Flow, r: AgentReply): Flow => ({
  ...flow,
  agent: r.agent,
  reply: r.reply,
  verified: r.verified,
  requested: r.refillRequested,
  phase: r.ended ? "end" : "agent",
});

/** The first flow of a new presenter call: the agent's guarded opener, or the menu. */
export async function openFlow(id: string): Promise<Flow> {
  if (!agentEnabled()) return first;
  try {
    const opened = await openAgent(id);
    return withReply({ ...first, mode: "agent" }, opened);
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
    const reply = text ? await agentTurn(id, flow.agent, text, { timeoutMs: TIMEOUT_MS[channel] }) : await agentSilence(id, flow.agent);
    return withReply(flow, reply);
  } catch (error) {
    return fallback(error);
  }
}
