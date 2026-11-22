import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromPGlite } from "@/lib/store/postgres";
import { postgresArchive } from "./archive";
import { signedDemoLine } from "./public-record";
import { verifiedReplayTicket } from "../../_lib/replay-tickets";
import { vi } from "vitest";

const scenario = "sam_ordinary_refill";
const completed = (at: string) => ({
  scenarioId: scenario, model: "fixture", at,
  events: [
    { type: "start", scenarioId: scenario },
    { type: "line", speaker: "caller", text: "My code is 112358 and my name is Sam Rivera." },
    { type: "action", label: "Verified caller identity" },
    { type: "line", speaker: "pharmacy", text: "How can I help?" },
    { type: "check", label: "stays on task", passed: true },
    { type: "verdict", passed: true, caught: 0, broken: 0 },
  ],
});

describe("isolated hosted run archive", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = new PGlite(); await pg.exec("create schema aegis_demo"); }, 60_000);
  afterAll(async () => { await pg.close(); });
  it("recovers a completed run from another instance, keeps each attempt, and never persists raw identity", async () => {
    const factory = () => postgresArchive(fromPGlite(pg));
    const writer = factory(), reader = factory();
    expect(await reader.latest(scenario)).toBeUndefined();
    await writer.save(scenario, completed("2026-11-22T16:00:00.000Z"));
    await writer.save(scenario, completed("2026-11-22T15:00:00.000Z"));
    const saved = await reader.latest(scenario);
    expect(saved?.at).toBe("2026-11-22T16:00:00.000Z");
    expect(saved?.events.at(-1)).toMatchObject({ type: "verdict", passed: true });
    const raw = await pg.query("select payload from aegis_demo.aegis_presenter_runs");
    expect(raw.rows).toHaveLength(2);
    expect(JSON.stringify(raw.rows)).not.toMatch(/112358|Sam Rivera|ticket/);
    expect(JSON.stringify(raw.rows)).toContain("[Verification details omitted]");
    expect(await reader.latest("greeting_slang_recovery")).toBeUndefined();
  });

  it("never stores incomplete or unrestricted input, even before a later replay", async () => {
    const writer = postgresArchive(fromPGlite(pg));
    const run = completed("2026-11-22T18:00:00.000Z");
    const initial = (await pg.query("select count(*) from aegis_demo.aegis_presenter_runs")).rows;
    for (const bad of [{ ...run, events: run.events.slice(0,-1) }, { ...run, record: [{ input: "private" }] },
      { ...run, events: run.events.map(e => e.type === "line" ? { ...e, ticket: "private" } : e) }]) {
      await expect(writer.save(scenario, bad)).rejects.toThrow();
    }
    expect((await pg.query("select count(*) from aegis_demo.aegis_presenter_runs")).rows).toEqual(initial);
  });

  it("reissues replay speech tickets that another process can verify with the deployment key", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "fixture-replay-key");
    try {
      const ticket = signedDemoLine(scenario, { type: "line", speaker: "pharmacy", text: "How can I help?" }, 4).ticket;
      expect(verifiedReplayTicket(ticket, "fixture-replay-key")).toMatchObject({ speaker: "pharmacy", text: "How can I help?" });
      expect(verifiedReplayTicket(ticket, "unrelated")).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
});
