import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLE_CLAIM, keepClaims } from "./auth0";
import { approverFromUser, getApprover, hasRole } from "./session";

afterEach(() => vi.unstubAllEnvs());

describe("approverFromUser", () => {
  it("takes id, name and role from the Auth0 user", () => {
    expect(approverFromUser({ sub: "auth0|p1", name: "Test Pharmacist", [ROLE_CLAIM]: "pharmacist" })).toEqual({
      id: "auth0|p1",
      name: "Test Pharmacist",
      role: "pharmacist",
    });
    expect(approverFromUser({ sub: "auth0|r1", email: "reviewer.test@example.com", [ROLE_CLAIM]: "reviewer" })).toEqual({
      id: "auth0|r1",
      name: "reviewer.test@example.com",
      role: "reviewer",
    });
  });

  it("is nobody without a known role or a subject", () => {
    expect(approverFromUser(null)).toBeNull();
    expect(approverFromUser({ sub: "auth0|x", name: "No Role" })).toBeNull();
    expect(approverFromUser({ sub: "auth0|x", [ROLE_CLAIM]: "admin" })).toBeNull();
    expect(approverFromUser({ name: "No Sub", [ROLE_CLAIM]: "pharmacist" })).toBeNull();
  });
});

describe("keepClaims", () => {
  it("keeps the standard profile claims and the role, drops the rest", () => {
    const kept = keepClaims({ sub: "auth0|p1", name: "Test Pharmacist", [ROLE_CLAIM]: "pharmacist", sid: "s", nonce: "n" });
    expect(kept).toEqual({ sub: "auth0|p1", name: "Test Pharmacist", [ROLE_CLAIM]: "pharmacist" });
  });
});

describe("getApprover", () => {
  it("is nobody when Auth0 isn't configured", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    expect(await getApprover()).toBeNull();
  });
});

describe("hasRole", () => {
  it("checks the contract Approver's single role", () => {
    expect(hasRole(null, "pharmacist")).toBe(false);
    expect(hasRole({ id: "u1", name: "Test Pharmacist", role: "pharmacist" }, "pharmacist")).toBe(true);
    expect(hasRole({ id: "u2", name: "Test Reviewer", role: "reviewer" }, "pharmacist")).toBe(false);
  });
});
