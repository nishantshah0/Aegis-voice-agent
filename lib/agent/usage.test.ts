import { describe, expect, it } from "vitest";
import { UsageCapError, createUsageCap } from "./usage";

function cap(perHour = 3) {
  let t = 0;
  const lines: string[] = [];
  const c = createUsageCap({ perHour, now: () => t, append: (_p, line) => lines.push(line) });
  return { c, lines, advance: (ms: number) => (t += ms) };
}

describe("1.2b: the Agent SDK usage cap", () => {
  it("allows calls up to the hourly cap, then refuses with a clear error", () => {
    const { c } = cap(3);
    c.check();
    c.record({ callId: "c_1", model: "claude-haiku-5-5", modelCalls: 2 });
    c.check();
    c.record({ callId: "c_1", model: "claude-haiku-5-5", modelCalls: 1 });
    expect(() => c.check()).toThrow(UsageCapError);
    expect(() => c.check()).toThrow(/3 model calls an hour/);
  });

  it("frees calls an hour later", () => {
    const { c, advance } = cap(1);
    c.record({ callId: "c_1", model: "m", modelCalls: 1 });
    expect(() => c.check()).toThrow(UsageCapError);
    advance(60 * 60 * 1000 + 1);
    expect(() => c.check()).not.toThrow();
  });

  it("logs every turn as one JSON line, with tokens", () => {
    const { c, lines } = cap();
    c.record({ callId: "c_1", model: "claude-haiku-5-5", modelCalls: 2, usage: { input_tokens: 900, output_tokens: 40 }, costUsd: 0.001 });
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0])).toMatchObject({ callId: "c_1", model: "claude-haiku-5-5", modelCalls: 2, usage: { input_tokens: 900 }, at: "1970-01-01T00:00:00.000Z" });
  });

  it("counts at least one call per turn", () => {
    const { c } = cap(1);
    c.record({ callId: "c_1", model: "m", modelCalls: 0 });
    expect(() => c.check()).toThrow(UsageCapError);
  });
});
