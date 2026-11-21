// A scripted stand-in for Claude, for tests: each model turn plays the next
// step of a script (text, then tool calls). No key, no network.
// It records every request it was given, so tests can check what the model saw.

import type Anthropic from "@anthropic-ai/sdk";
import type { AgentModel, ModelEvent, ModelRequest, ModelTurn } from "../model";

export type ScriptStep = {
  /** Text the model streams, in chunks, before any tool call. */
  text?: string[];
  /** Tool calls, in order. */
  tools?: { name: string; input: unknown }[];
  /** Defaults to tool_use when there are tools, else end_turn. */
  stop?: ModelTurn["stop_reason"];
};

export type ScriptedModel = AgentModel & { requests: ModelRequest[]; remaining(): number };

export function scriptedModel(steps: ScriptStep[]): ScriptedModel {
  const queue = [...steps];
  const requests: ModelRequest[] = [];
  let ids = 0;
  return {
    requests,
    remaining: () => queue.length,
    async *turn(request): AsyncIterable<ModelEvent> {
      // Copy, since the driver keeps appending to the same array.
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const step = queue.shift();
      if (!step) throw new Error("scripted model: no step left for this turn");
      for (const chunk of step.text ?? []) yield { type: "text", text: chunk };
      const content: Anthropic.Beta.BetaContentBlock[] = [];
      const said = (step.text ?? []).join("");
      if (said) content.push({ type: "text", text: said, citations: null } as Anthropic.Beta.BetaContentBlock);
      for (const tool of step.tools ?? []) {
        content.push({ type: "tool_use", id: `toolu_${++ids}`, name: tool.name, input: tool.input } as Anthropic.Beta.BetaContentBlock);
      }
      const stop_reason = step.stop ?? (step.tools?.length ? "tool_use" : "end_turn");
      yield { type: "done", turn: { stop_reason, content } };
    },
  };
}

/** Collect everything a callerSays turn yields. */
export async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of events) out.push(e);
  return out;
}
