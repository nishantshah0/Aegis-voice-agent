import { describe, expect, it } from "vitest";
import { BUTTON_NAMES } from "@/lib/contract";
import { checkInput } from "@/lib/control";
import { BUTTON_TOOLS, isButtonName } from "./tools";

type Prop = { type: string; enum?: string[] };

const SAMPLE: Record<string, unknown> = { boolean: false, integer: 7 };

/** An input with every field the schema lists, filled in. */
function sample(properties: Record<string, Prop>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([k, p]) => [k, p.type in SAMPLE ? SAMPLE[p.type] : (p.enum?.[0] ?? "x")]));
}

describe("1.2: the 12 buttons as tools", () => {
  it("are exactly the 12 buttons, in order, each strict", () => {
    expect(BUTTON_TOOLS.map((t) => t.name)).toEqual([...BUTTON_NAMES]);
    for (const tool of BUTTON_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("only ask for inputs the control layer accepts, and require what it requires", () => {
    for (const tool of BUTTON_TOOLS) {
      const properties = (tool.input_schema.properties ?? {}) as Record<string, Prop>;
      const required = (tool.input_schema.required ?? []) as string[];
      const valid = sample(properties);
      // An ordinary pharmacist note has no appointment slot. The appointment shape is tested separately.
      if (tool.name === "note_for_pharmacist") delete valid.slot_id;
      expect(checkInput(tool.name as never, valid), tool.name).toMatchObject({ ok: true });
      for (const key of required) {
        const missing = { ...valid };
        delete missing[key];
        expect(checkInput(tool.name as never, missing).ok, `${tool.name} without ${key}`).toBe(false);
      }
    }
  });

  it.each(["check_coverage", "request_refill"] as const)("sends a strict integer schema for %s and enforces positive days in control", (name) => {
    const tool = BUTTON_TOOLS.find((candidate) => candidate.name === name)!;
    const fields = tool.input_schema.properties as Record<string, Prop>;
    const field = fields.days_supply;
    expect(tool.strict).toBe(true);
    expect(field).toMatchObject({ type: "integer" });
    expect(field).not.toHaveProperty("minimum"); // The Messages API rejects this keyword on strict integer inputs.
    expect(tool.input_schema.required).not.toContain("days_supply");
    for (const days_supply of [0, -1, 1.5, "7"]) {
      expect(checkInput(name, { rx_id: "rx_demo", days_supply }).ok).toBe(false);
    }
    expect(checkInput(name, { rx_id: "rx_demo", days_supply: 7 }).ok).toBe(true);
  });

  it("describe what a button does without listing what it refuses", () => {
    for (const tool of BUTTON_TOOLS) expect(tool.description ?? "").not.toMatch(/\b(never|must not|forbidden|refuse)/i);
  });

  it("let check_code carry the date of birth, which outbound calls need, without requiring it inbound", () => {
    const checkCode = BUTTON_TOOLS.find((t) => t.name === "check_code")!;
    expect(Object.keys(checkCode.input_schema.properties ?? {})).toEqual(["lookup_id", "code", "dob"]);
    expect(checkCode.input_schema.required).toEqual(["lookup_id", "code"]);
  });

  it("recognise only button names", () => {
    expect(isButtonName("request_refill")).toBe(true);
    expect(isButtonName("change_address")).toBe(false);
  });
});
