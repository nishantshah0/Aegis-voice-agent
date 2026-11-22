import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTestDatabase } from "@/vitest.setup";
import { resetRuntimeForTests } from "./_lib/runtime";

// Tests must never reset the shared demo database (URGENT, 2026-11-22). Two locks:
// vitest.setup.ts clears DATABASE_URL before any test module loads, and
// resetRuntimeForTests refuses a Postgres store unless ALLOW_TEST_DB_RESET=1.
// The URL below is fake: nothing listens on port 1, and the guard fires before any connection.

const FAKE = "postgres://u:p@127.0.0.1:1/none";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resetRuntimeForTests guard", () => {
  it("refuses to reset a Postgres store", async () => {
    vi.stubEnv("DATABASE_URL", FAKE);
    vi.stubEnv("ALLOW_TEST_DB_RESET", "");
    await expect(resetRuntimeForTests()).rejects.toThrow(/ALLOW_TEST_DB_RESET=1/);
  });

  it("still resets the memory store", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(resetRuntimeForTests()).resolves.toBeUndefined();
  });
});

describe("vitest setup", () => {
  it("clears DATABASE_URL before tests run", () => {
    const env = { DATABASE_URL: FAKE, DATABASE_CA_FILE: "ca.pem", OTHER: "kept" } as NodeJS.ProcessEnv;
    clearTestDatabase(env);
    expect(env).toEqual({ OTHER: "kept" });
  });

  it("keeps it only for the opt-in live database test (LIVE_DB=1, its own schema)", () => {
    const env = { DATABASE_URL: FAKE, LIVE_DB: "1" } as NodeJS.ProcessEnv;
    clearTestDatabase(env);
    expect(env.DATABASE_URL).toBe(FAKE);
  });

  it("left no DATABASE_URL for this test run", () => {
    if (process.env.LIVE_DB !== "1") expect(process.env.DATABASE_URL).toBeUndefined();
  });
});
