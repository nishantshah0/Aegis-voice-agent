import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeModel } from "./anthropic";

// What the Messages API request carries (CLAUDE.md, "Using the Claude API in the product").
// A fake client records the request; no key, no network.

function fakeClient() {
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          sent.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi." } };
            },
            finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Hi." }] }),
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

async function run(model?: string, effort?: "low" | "medium" | "high") {
  const { client, sent } = fakeClient();
  const turn = createClaudeModel({ client, model, effort }).turn({ callId: "c_1", system: "s", messages: [{ role: "user", content: "hi" }], tools: [], press: async () => ({ content: "", isError: false }) });
  for await (const event of turn) void event;
  return sent[0];
}

describe("createClaudeModel", () => {
  it("asks for automatic tool choice and the given effort", async () => {
    const params = await run("claude-haiku-5-5", "low");
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.model).toBe("claude-haiku-5-5");
  });

  it("keeps the server-side refusal fallback for the call model (Sonnet 5.5)", async () => {
    const params = await run();
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
  });

  it("leaves it out on Haiku 5.5, which has no server-side fallback (the driver hands over on a refusal)", async () => {
    const params = await run("claude-haiku-5-5", "low");
    expect(params).not.toHaveProperty("betas");
    expect(params).not.toHaveProperty("fallbacks");
  });
});
