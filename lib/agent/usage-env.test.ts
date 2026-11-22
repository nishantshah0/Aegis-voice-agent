import { describe, expect, it } from "vitest";
import { callsPerHour } from "./usage";

// The hourly cap can be set with AGENT_CALLS_PER_HOUR; anything that isn't a whole
// number above zero falls back to Nishant's 60.

describe("AGENT_CALLS_PER_HOUR", () => {
  it("defaults to 60 calls an hour", () => {
    expect(callsPerHour(undefined)).toBe(60);
    expect(callsPerHour("")).toBe(60);
  });

  it("takes a whole number above zero", () => {
    expect(callsPerHour("120")).toBe(120);
    expect(callsPerHour(" 30 ")).toBe(30);
  });

  it("ignores anything else", () => {
    for (const raw of ["0", "-5", "1.5", "abc", "60 calls", "Infinity"]) expect(callsPerHour(raw)).toBe(60);
  });
});
