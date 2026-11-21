// The seam between the agent loop and Claude.
//
// The driver asks for one model turn and gets back streamed text, then the
// finished turn. lib/agent/anthropic.ts is the real one; tests use a scripted
// model, so the loop runs with no key and no network.

import type Anthropic from "@anthropic-ai/sdk";

export type ModelRequest = {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
};

/** The finished turn: what the driver needs from the final message. */
export type ModelTurn = Pick<Anthropic.Beta.BetaMessage, "stop_reason" | "content">;

export type ModelEvent = { type: "text"; text: string } | { type: "done"; turn: ModelTurn };

export interface AgentModel {
  /** One model turn. Yields text as it streams, then exactly one "done". */
  turn(request: ModelRequest): AsyncIterable<ModelEvent>;
}
