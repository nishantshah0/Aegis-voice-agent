import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BUTTON_NAMES } from "@/lib/contract";
import { BUTTON_TOOLS } from "./tools";
import { startAgentSdkSession, zodShape } from "./agent-sdk-session";

afterEach(() => vi.unstubAllEnvs());

describe("1.2b: the real Agent SDK session", () => {
  it("won't start without LIVE_AGENT=1, so tests and CI never spend usage", () => {
    vi.stubEnv("LIVE_AGENT", "");
    expect(() => startAgentSdkSession({ system: "s", tools: [], model: "claude-haiku-5-5", maxTurns: 4 })).toThrow(/LIVE_AGENT=1/);
  });

  it("turns each button's strict schema into the same zod shape", () => {
    const check = BUTTON_TOOLS.find((t) => t.name === "check_code")!;
    const shape = zodShape(z, check.input_schema);
    expect(Object.keys(shape)).toEqual(["lookup_id", "code", "dob"]);
    const schema = z.object(shape).strict();
    expect(schema.safeParse({ lookup_id: "l", code: "1" }).success).toBe(true);
    expect(schema.safeParse({ lookup_id: "l" }).success).toBe(false);
    expect(schema.safeParse({ lookup_id: "l", code: "1", extra: 1 }).success).toBe(false);
    const note = BUTTON_TOOLS.find((t) => t.name === "note_for_pharmacist")!;
    const noteSchema = z.object(zodShape(z, note.input_schema));
    expect(noteSchema.safeParse({ text: "x", kind: "side_effect" }).success).toBe(true);
    expect(noteSchema.safeParse({ text: "x", kind: "advice" }).success).toBe(false);
    const rx = BUTTON_TOOLS.find((t) => t.name === "check_prescription")!;
    expect(z.object(zodShape(z, rx.input_schema)).safeParse({ rx_id: "r", include_other_names: true }).success).toBe(true);
  });
});

describe("1.2b: live-run fixes (results/agent-live/sam-2026-11-21T16-47-10-176Z.json)", () => {
  it("locks the session to the 12 buttons: no built-ins, no other MCP servers, plugins, skills or settings", async () => {
    const { sessionOptions } = await import("./agent-sdk-session");
    const tools = BUTTON_TOOLS.map((t) => ({ name: t.name, description: "", schema: t.input_schema, run: async () => ({ content: "", isError: false }) })) as never;
    const o = sessionOptions({ system: "s", tools, model: "claude-haiku-5-5", maxTurns: 4 }, { fake: "server" });
    expect(o).toMatchObject({ tools: [], strictMcpConfig: true, plugins: [], skills: [], settingSources: [], permissionMode: "dontAsk", persistSession: false, model: "claude-haiku-5-5", effort: "low" });
    expect(o.allowedTools).toHaveLength(BUTTON_NAMES.length);
    expect(o.allowedTools.every((n: string) => n.startsWith("mcp__buttons__"))).toBe(true);
    expect(Object.keys(o.mcpServers)).toEqual(["buttons"]);
  });

  it("counts one model call per message id, not per streamed block", async () => {
    const { createCallCounter } = await import("./agent-sdk-session");
    const count = createCallCounter();
    for (const id of ["m1", "m1", "m1", "m2", "m2", "m3"]) count(id);
    expect(count.total()).toBe(3);
  });
});
