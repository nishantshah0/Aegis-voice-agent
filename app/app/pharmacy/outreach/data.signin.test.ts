import { beforeEach, describe, expect, it, vi } from "vitest";

// The Outreach loader checks the session itself, before reading any saved run, so a
// signed-out request gets nothing even if a layout's check were missed (Trail #67).
const auth = vi.hoisted(() => ({ approver: null as null | { id: string; name: string; role: "pharmacist" | "reviewer" } }));
vi.mock("@/lib/auth/session", () => ({ getApprover: async () => auth.approver }));
const sim = vi.hoisted(() => ({ listRuns: vi.fn(async () => []), readRun: vi.fn(async () => null) }));
vi.mock("@/lib/sim", () => sim);

import { loadOutreachSignedIn } from "./data";

describe("Outreach loader sign-in", () => {
  beforeEach(() => {
    sim.listRuns.mockClear();
    sim.readRun.mockClear();
  });

  it("returns signed_out and reads nothing when nobody is signed in", async () => {
    auth.approver = null;
    expect(await loadOutreachSignedIn()).toEqual({ state: "signed_out" });
    expect(sim.listRuns).not.toHaveBeenCalled();
    expect(sim.readRun).not.toHaveBeenCalled();
  });

  it("reads saved runs for signed-in staff", async () => {
    auth.approver = { id: "u_test", name: "Test Pharmacist", role: "pharmacist" };
    expect((await loadOutreachSignedIn()).state).toBe("none");
    expect(sim.listRuns).toHaveBeenCalled();
  });
});
