// The seam between the agent loop and Claude.
//
// The driver asks for one model turn and gets back streamed text, then the
// finished turn. lib/agent/anthropic.ts is the real one; tests use a scripted
// model, so the loop runs with no key and no network.

import type Anthropic from "@anthropic-ai/sdk";
import type { CallId } from "@/lib/contract";

/**
 * For models that run their own tool steps (the Agent SDK): press a button through
 * the driver, which goes through control.press and yields the press. Returns what
 * the model sees as the tool result.
 */
export type PressForModel = (button: string, input: unknown) => Promise<{ content: string; isError: boolean }>;

export type ModelRequest = {
  callId: CallId;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  /** Given by the driver. Models that return tool_use blocks (the Messages API) ignore it. */
  press?: PressForModel;
};

/** The finished turn: what the driver needs from the final message. */
export type ModelTurn = Pick<Anthropic.Beta.BetaMessage, "stop_reason" | "content">;

export type ModelEvent = { type: "text"; text: string } | { type: "done"; turn: ModelTurn };

export interface AgentModel {
  /** One model turn. Yields text as it streams, then exactly one "done". */
  turn(request: ModelRequest): AsyncIterable<ModelEvent>;
  /** The call ended: drop anything kept for it. */
  endCall?(callId: CallId): void;
}
