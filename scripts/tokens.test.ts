import { describe, expect, it } from "vitest";
import { summarizeUsage } from "./tokens";

const line = (model: string, callId: string, usage: Record<string, unknown>, costUsd: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: "2026-11-21T16:00:00.000Z", callId, model, modelCalls: 2, usage, costUsd, subtype: "success", ...extra });

const usage = (input: number, write: number, read: number, output: number, thinking = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  output_tokens: output,
  output_tokens_details: { thinking_tokens: thinking },
});

describe("summarizeUsage", () => {
  it("sums tokens, model calls and the SDK's own cost per model", () => {
    const summary = summarizeUsage([
      line("claude-haiku-5-5", "c_0001", usage(2, 100, 0, 50, 40), 0.01),
      line("claude-haiku-5-5", "c_0001", usage(3, 0, 100, 20), 0.002),
      line("claude-sonnet-5-5", "c_0002", usage(10, 0, 0, 5), 0.03),
    ]);
    expect(summary.models["claude-haiku-5-5"]).toEqual({
      calls: 1,
      turns: 2,
      modelCalls: 4,
      errors: 0,
      inputTokens: 205,
      uncachedInputTokens: 5,
      cacheWriteTokens: 100,
      cacheReadTokens: 100,
      outputTokens: 70,
      thinkingTokens: 40,
      costUsd: 0.012,
    });
    expect(summary.total).toMatchObject({ calls: 2, turns: 3, modelCalls: 6, inputTokens: 215, outputTokens: 75, costUsd: 0.042 });
  });

  it("counts error turns, skips blank lines and reports lines it can't read", () => {
    const summary = summarizeUsage([
      line("claude-haiku-5-5", "c_1", usage(1, 0, 0, 1), 0.001, { subtype: "error_during_execution" }),
      "",
      "not json",
      JSON.stringify({ model: "claude-haiku-5-5" }),
    ]);
    expect(summary.models["claude-haiku-5-5"].errors).toBe(1);
    expect(summary.models["claude-haiku-5-5"].turns).toBe(1);
    expect(summary.skippedLines).toBe(2);
  });

  it("leaves cost out rather than guessing when the log has none", () => {
    const summary = summarizeUsage([JSON.stringify({ callId: "c_1", model: "claude-haiku-5-5", modelCalls: 1, usage: usage(1, 0, 0, 1) })]);
    expect(summary.models["claude-haiku-5-5"].costUsd).toBeNull();
    expect(summary.total.costUsd).toBeNull();
  });

  it("returns an empty table for an empty log", () => {
    expect(summarizeUsage([])).toMatchObject({ models: {}, total: { turns: 0, costUsd: null } });
  });
});
