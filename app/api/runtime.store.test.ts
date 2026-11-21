import { afterEach, describe, expect, it, vi } from "vitest";
import { getStore as getMemoryStore } from "@/lib/store/memory";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetRuntimeForTests();
});

describe("the server's store (2.7)", () => {
  it("is the memory store without DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(getStore()).toBe(getMemoryStore());
  });

  it("is a Postgres store when DATABASE_URL is set (no connection is made until it's used)", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/none");
    const store = getStore();
    expect(store).not.toBe(getMemoryStore());
    expect(getStore()).toBe(store);
  });
});
