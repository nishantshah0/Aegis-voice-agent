import { describe, expect, it } from "vitest";
import { BUTTON_NAMES } from "@/lib/contract";
import { checkInput } from "@/lib/control";
import { BUTTON_TOOLS, isButtonName } from "./tools";

type Prop = { type: string; enum?: string[] };

/** An input with every field the schema lists, filled in. */
function sample(properties: Record<string, Prop>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([k, p]) => [k, p.type === "boolean" ? false : (p.enum?.[0] ?? "x")]));
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
      expect(checkInput(tool.name as never, sample(properties)), tool.name).toMatchObject({ ok: true });
      for (const key of required) {
        const missing = sample(properties);
        delete missing[key];
        expect(checkInput(tool.name as never, missing).ok, `${tool.name} without ${key}`).toBe(false);
      }
    }
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
