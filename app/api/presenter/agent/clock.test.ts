import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import { SEED } from "@/lib/seed";
import { getStore } from "@/lib/store/memory";
import { openAgent, setAgentModelForTests } from "./agent";
import { POST as reset } from "../reset/route";

// Trail #70: the hosted store's demo clock never moves on its own, so a code lockout set on it
// would never expire. Each presenter call moves it forward by the real time since the last one
// (never back), and says so on the record. Plus an emergency Reset demo for the presenter.

const { local } = vi.hoisted(() => ({ local: { database: undefined as PGlite | undefined } }));
vi.mock("pg", () => ({
  Pool: class {
    db = (local.database ??= new PGlite());
    on() {}
    query(sql: string, args?: unknown[]) {
      return this.db.query(sql, args);
    }
    async connect() {
      return { query: this.query.bind(this), release() {} };
    }
  },
}));

const secret = "x".repeat(48);
const origin = "https://presenter.example";
const MIN = 60_000;

beforeEach(async () => {
  vi.stubEnv("AEGIS_DEMO_STORAGE_URL", "postgresql://fixture@db.invalid/fixture");
  vi.stubEnv("AEGIS_PRESENTER_SECRET", secret);
  vi.stubEnv("AEGIS_PUBLIC_ORIGIN", origin);
  setAgentModelForTests(() => scriptedModel([]));
  await getStore().reset(SEED);
  local.database ??= new PGlite();
  await local.database.exec("DROP TABLE IF EXISTS aegis_presenter_clock; DROP TABLE IF EXISTS aegis_presenter_agent_turns");
});
afterEach(() => {
  setAgentModelForTests(undefined);
  vi.unstubAllEnvs();
});

/** Pretend the last presenter call opened `ms` ago in real time. */
const lastOpenedAgo = (ms: number) => local.database!.query("UPDATE aegis_presenter_clock SET real_at = now() - ($1::int * interval '1 millisecond')", [ms]);

describe("the demo clock on presenter calls", () => {
  it("moves forward by the real time since the last presenter call, keeping its offset, and records it", async () => {
    const start = await getStore().now();
    await openAgent(randomUUID(), "browser");
    expect(await getStore().now()).toBe(start); // the first call only notes the time
    await lastOpenedAgo(20 * MIN);
    await openAgent(randomUUID(), "browser");
    const moved = await getStore().now();
    expect(Date.parse(moved) - Date.parse(start)).toBeGreaterThanOrEqual(20 * MIN);
    expect(Date.parse(moved) - Date.parse(start)).toBeLessThan(21 * MIN);
    expect(moved.slice(-6)).toBe(start.slice(-6)); // same -05:00 offset
    const entry = (await getStore().listRecord()).find((e) => (e.input as { check?: string })?.check === "demo_clock_advanced");
    expect(entry?.input).toMatchObject({ from: start, to: moved });
  });

  it("never moves back, and doesn't jump forward after someone resets the demo", async () => {
    await openAgent(randomUUID(), "browser");
    await lastOpenedAgo(30 * MIN);
    await openAgent(randomUUID(), "browser");
    const later = await getStore().now();
    await getStore().reset(SEED); // the clock goes back to the seed's Tuesday 10 AM
    await lastOpenedAgo(5 * MIN);
    await openAgent(randomUUID(), "browser");
    expect(await getStore().now()).toBe(SEED.now);
    expect(Date.parse(later)).toBeGreaterThan(Date.parse(SEED.now));
  });
});

describe("the presenter's Reset demo", () => {
  const post = (body: unknown, presenter = true) =>
    new Request(origin + "/api/presenter/reset", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(presenter ? { "x-aegis-presenter": secret } : {}) }, body: JSON.stringify(body) });

  it("is presenter-only, needs an explicit confirm, and clears the calls", async () => {
    await openAgent(randomUUID(), "browser");
    expect((await getStore().listRecord()).length).toBeGreaterThan(0);
    expect((await reset(post({ confirm: "reset" }, false))).status).toBe(403);
    expect((await reset(post({}))).status).toBe(400);
    const res = await reset(post({ confirm: "reset" }));
    expect(res.status).toBe(200);
    expect(await getStore().listRecord()).toHaveLength(0);
    expect(await getStore().now()).toBe(SEED.now);
  });
});

describe("the dashboard store on Vercel", () => {
  it("accepts the hosted demo's store (AEGIS_DEMO_STORAGE_URL) where DATABASE_URL isn't set", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PATIENT_SIMULATION", "community-demo");
    const { dashboardStoreUrlForTests } = await import("./agent");
    expect(dashboardStoreUrlForTests()).toBe("postgresql://fixture@db.invalid/fixture");
    vi.stubEnv("PATIENT_SIMULATION", "");
    expect(dashboardStoreUrlForTests()).toBeUndefined();
  });
});
