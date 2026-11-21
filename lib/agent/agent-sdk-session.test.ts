import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
