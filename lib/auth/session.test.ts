import { describe, expect, it } from "vitest";
import { getApprover, hasRole } from "./session";

describe("session", () => {
  it("has nobody signed in until Auth0 is wired (task 2.4)", async () => {
    expect(await getApprover(new Request("http://test.local/"))).toBeNull();
  });

  it("checks the contract Approver's single role", () => {
    expect(hasRole(null, "pharmacist")).toBe(false);
    expect(hasRole({ id: "u1", name: "Test Pharmacist", role: "pharmacist" }, "pharmacist")).toBe(true);
    expect(hasRole({ id: "u2", name: "Test Reviewer", role: "reviewer" }, "pharmacist")).toBe(false);
  });
});
