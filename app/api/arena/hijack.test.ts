import { readdirSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { resetRuntimeForTests } from "../_lib/runtime";
import { runHijackNow, hijackRunning } from "./hijack/run";
import { POST as hijack } from "./hijack/route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => void Promise.resolve().then(task),
}));
const session = vi.hoisted(() => ({ approver: null as null | { id: string; name: string; role: "pharmacist" | "reviewer" } }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

let dir = "";
beforeEach(async () => {
  session.approver = null;
  vi.unstubAllEnvs();
  resetBusForTests();
  await resetRuntimeForTests();
  dir = await mkdtemp(join(tmpdir(), "hijack-"));
  vi.stubEnv("RESULTS_DIR", dir);
});

describe("POST /api/arena/hijack", () => {
  it("refuses someone who isn't signed in", async () => {
    expect((await hijack()).status).toBe(401);
  });

  it("starts the batch for staff and answers 202", async () => {
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    const res = await hijack();
    expect(res.status).toBe(202);
    while (hijackRunning()) await new Promise((r) => setTimeout(r, 20));
  }, 30_000);
});

describe("runHijackNow", () => {
  it("saves every card's result to results/ before its score event, and scores 0 broken on the real lock", async () => {
    const scores: Extract<StreamEvent, { type: "score" }>[] = [];
    const savedAtScore: number[] = [];
    subscribe((d) => {
      if (d.event.type !== "score") return;
      scores.push(d.event);
      const runDirs = readdirSync(join(dir, "hijack"));
      savedAtScore.push(runDirs.length === 1 ? readdirSync(join(dir, "hijack", runDirs[0])).length : 0);
    });
    const { runDir, runs } = await runHijackNow({ pause: async () => {} });
    expect(runs).toHaveLength(4);
    expect(savedAtScore).toEqual([1, 2, 3, 4]);
    const files = (await readdir(runDir)).sort();
    expect(files).toEqual(runs.map((r) => `${r.cardId}.json`).sort());
    const saved = JSON.parse(await readFile(join(runDir, files[0]), "utf8"));
    expect(saved).toMatchObject({ cardId: expect.any(String), score: expect.any(Object) });
    expect(scores).toHaveLength(4);
    expect(scores.at(-1)!.broken).toBe(0);
    expect(runDir.startsWith(dir)).toBe(true);
  });

  it("refuses a second batch while one is running", async () => {
    const first = runHijackNow({ pause: () => new Promise((r) => setTimeout(r, 50)) });
    await expect(runHijackNow({ pause: async () => {} })).rejects.toThrow(/already running/);
    await first;
  });
});
