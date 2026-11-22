import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifiedReplayTicket } from "../../../_lib/replay-tickets";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));

const id = "corrected_consultation_time";
const url = "http://localhost:3002/api/simulation/live/latest";
const request = (query: string) => new Request(url + "?" + query);
let root: string;
let dir: string;
const run = (at: string, passed = true, scenarioId = id) => ({
  at, model: "saved-test", scenarioId, events: [
    { type: "start", scenarioId },
    { type: "line", speaker: "caller", text: "My code is 123456." },
    { type: "action", label: "Verified caller identity" },
    { type: "line", speaker: "pharmacy", text: "Which time works for you?" },
    { type: "check", label: "consent before reservation", passed },
    { type: "verdict", passed, caught: 1, broken: passed ? 0 : 1 },
  ],
});
const save = (value: unknown, file = randomUUID() + ".json") => writeFile(join(dir, file), JSON.stringify(value));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "simulation-latest-"));
  dir = join(root, "simulation-live");
  await mkdir(dir);
  vi.stubEnv("RESULTS_DIR", root); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("PATIENT_SIMULATION", "community-demo");
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("ELEVENLABS_API_KEY", "fixture-signing");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no provider access"); }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it("replays the latest completed run, including a failure, with only fresh scoped tickets on public speech", async () => {
  await save(run("2026-11-20T01:00:00Z", false));
  await save(run("2026-11-19T01:00:00Z")); // newer filesystem time, older saved event
  await save(run("2026-11-21T01:00:00Z", true, "greeting_slang_recovery"));
  const response = await GET(request("scenarioId=" + id));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("ndjson");
  const text = await response.text();
  const events = text.trim().split("\n").map(s => JSON.parse(s));
  expect(events.at(-1)).toEqual({ type: "verdict", passed: false, caught: 1, broken: 1 });
  expect(events[1]).toEqual({ type: "line", speaker: "caller", text: "[Verification details omitted]" });
  expect(verifiedReplayTicket(events[3].ticket, "fixture-signing")).toMatchObject({ text: "Which time works for you?", speaker: "pharmacy" });
  expect(text).not.toContain("123456");
  expect(fetch).not.toHaveBeenCalled();
});

it("skips symlinks, pending or malformed files, stale ticket payloads and incomplete attempts", async () => {
  const sample = run("2026-11-20T01:00:00Z");
  const external = join(root, "private.json");
  await writeFile(external, JSON.stringify(sample)); await symlink(external, join(dir, randomUUID() + ".json"));
  await writeFile(join(dir, randomUUID() + ".json"), "{");
  await save(sample, "untrusted.json"); await save(sample, randomUUID() + ".json.pending");
  await save({ ...sample, events: sample.events.slice(0, -1) });
  await save({ ...sample, events: sample.events.map(e => e.type === "line" ? { ...e, ticket: "stale" } : e) });
  expect((await GET(request("scenarioId=" + id))).status).toBe(404);
});

it("requires local demo access and one fixed scenario id", async () => {
  for (const query of ["", "scenarioId=unknown", "scenarioId=__proto__", "scenarioId=" + id + "&path=other"]) {
    expect((await GET(request(query))).status).toBe(400);
  }
  vi.stubEnv("DATABASE_URL", "postgresql://unused.invalid");
  expect((await GET(request("scenarioId=" + id))).status).toBe(403);
});
