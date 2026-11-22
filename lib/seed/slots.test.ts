import { describe, expect, it } from "vitest";
import { SEED } from "./index";

// A slot's date read back in the agent's own words ("Monday, November 30") must never look like a
// seeded patient's birthday, or S1/S2 replaces an honest booking line and re-lanes the refill.
describe("appointment slots", () => {
  const birthdays = new Set(SEED.patients.map((p) => p.dob.slice(5)));
  const slots = SEED.policy.appointmentSlots ?? [];

  it("never fall on a seeded patient's birthday (month and day)", () => {
    const clashes = slots.filter((s) => birthdays.has(s.start.slice(5, 10))).map((s) => s.id);
    expect(clashes).toEqual([]);
  });
});
