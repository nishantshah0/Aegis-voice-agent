// The real model: Claude through the Messages API, one streamed turn at a time.
// Server-only. The key comes from ANTHROPIC_API_KEY in the server's .env.
//
// We own the tool loop (lib/agent/driver.ts), so every tool call the model makes
// is pressed through the control layer. Tool choice is automatic: forced tool
// choice is rejected on these models, and strict schemas keep inputs well formed.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentModel, ModelEvent, ModelRequest } from "./model";

/** The call's model (CLAUDE.md, "Using the Claude API in the product"). */
export const CALL_MODEL = "claude-sonnet-5-5";

export type ClaudeModelOptions = {
  client?: Anthropic;
  model?: string;
  /** A phone turn wants a quick answer: low effort until 1.6's timings say otherwise. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

export function createClaudeModel({
  client = new Anthropic(),
  model = CALL_MODEL,
  effort = "low",
  maxTokens = 4096,
}: ClaudeModelOptions = {}): AgentModel {
  return {
    async *turn({ system, messages, tools }: ModelRequest): AsyncIterable<ModelEvent> {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        // The prompt is fixed per pharmacy and direction, so tools + system cache.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        tool_choice: { type: "auto" },
        output_config: { effort },
        // If a safety classifier declines, the API reruns the turn on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const message = await stream.finalMessage();
      yield { type: "done", turn: { stop_reason: message.stop_reason, content: message.content } };
    },
  };
}
