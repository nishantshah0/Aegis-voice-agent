import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaStatus } from "../_lib/arena-runs";
import { resetArenaRunsForTests } from "../_lib/arena-runs";
import { GET as status, POST as runSuite } from "./run/route";
import { GET as nightStatus, POST as runNight } from "./overnight/route";

// The Safety suite's run routes (Role 2 stand-in, Trail #68). Role 3's runners and the
// Agent SDK model are faked here: nothing in these tests calls a model.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => void Promise.resolve().then(task),
}));

type Approver = { id: string; name: string; role: "pharmacist" | "reviewer" };
const session = vi.hoisted(() => ({ approver: null as null | Approver }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const usage = vi.hoisted(() => ({ log: "" }));
vi.mock("@/lib/arena/pace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/arena/pace")>()),
  readUsageLog: () => async () => usage.log,
}));

vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent")>()),
  createAgentSdkModel: () => ({ name: "fake" }),
}));

/** A run we finish by hand, so the test can look at it while it's going. */
function gate() {
  let open!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { done, open, fail };
}

const runners = vi.hoisted(() => ({
  suite: vi.fn(),
  night: vi.fn(),
}));
vi.mock("@/lib/arena/suite-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/arena/suite-files")>()),
  runFixedScenarioSuite: runners.suite,
}));
vi.mock("@/lib/arena/overnight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/arena/overnight")>()),
  runOvernight: runners.night,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const REVIEWER: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };

const post = (body?: unknown) =>
  new Request("http://localhost/api/arena/run", {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const read = async (): Promise<ArenaStatus> => (await (await status()).json()) as ArenaStatus;
const tick = () => new Promise((r) => setTimeout(r, 0));
const hourAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let dir = "";
beforeEach(async () => {
  session.approver = null;
  usage.log = "";
  vi.unstubAllEnvs();
  // Never the shared database: these tests must run on memory stores whatever .env says.
  vi.stubEnv("DATABASE_URL", "");
  resetArenaRunsForTests();
  runners.suite.mockReset();
  runners.night.mockReset();
  dir = await mkdtemp(join(tmpdir(), "arena-run-"));
  vi.stubEnv("RESULTS_DIR", dir);
  vi.stubEnv("LIVE_AGENT", "1");
});

describe("who may start a run", () => {
  it("refuses someone who isn't signed in, and a reviewer", async () => {
    expect((await runSuite(post())).status).toBe(401);
    expect((await runNight(post())).status).toBe(401);
    session.approver = REVIEWER;
    expect((await runSuite(post())).status).toBe(403);
    expect((await runNight(post())).status).toBe(403);
    expect(runners.suite).not.toHaveBeenCalled();
    expect(runners.night).not.toHaveBeenCalled();
  });

  it("says so when the live agent is off, rather than scoring a fake", async () => {
    session.approver = PHARMACIST;
    vi.stubEnv("LIVE_AGENT", "");
    const res = await runSuite(post());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/LIVE_AGENT/);
  });

  it("only lets staff read the progress", async () => {
    expect((await status()).status).toBe(401);
    expect((await nightStatus()).status).toBe(401);
    session.approver = REVIEWER;
    expect((await status()).status).toBe(200);
  });
});

describe("POST /api/arena/run (the fixed scenario suite)", () => {
  it("runs Role 3's suite one call at a time into results/, and reports progress as attempts save", async () => {
    session.approver = PHARMACIST;
    const run = gate();
    runners.suite.mockImplementation(async (options: { saveAttempt: (id: string, n: number, r: unknown) => Promise<void> }) => {
      await options.saveAttempt("copay", 1, {});
      await options.saveAttempt("copay", 2, {});
      await run.done;
      return { report: { caught: 4, broken: 0, passed: 1, totalScenarios: 28, completed: true }, resultPath: join(dir, "arena", "scenarios", "r", "scoreboard.json") };
    });

    const res = await runSuite(post());
    expect(res.status).toBe(202);
    await tick();
    await tick();

    const options = runners.suite.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.concurrency).toBe(1);
    expect(String(options.resultsDirectory).startsWith(dir)).toBe(true);
    expect(typeof options.makeSession).toBe("function");

    const during = await read();
    expect(during.running).toMatchObject({ kind: "suite", state: "running", done: 2, total: 61 * 3 });

    run.open();
    await tick();
    await tick();
    const after = await read();
    expect(after.running).toBeNull();
    expect(after.last.suite).toMatchObject({ state: "done", caught: 4, broken: 0 });
    expect(after.last.suite?.resultPath).toContain("scoreboard.json");
  });

  it("runs only the scenarios asked for, and refuses unknown ids", async () => {
    session.approver = PHARMACIST;
    runners.suite.mockResolvedValue({ report: { caught: 0, broken: 0 }, resultPath: "x" });
    expect((await runSuite(post({ only: ["not_a_scenario"] }))).status).toBe(400);
    expect((await runSuite(post({ only: ["copay", "claimed_pharmacist"] }))).status).toBe(202);
    await tick();
    expect((runners.suite.mock.calls[0]![0] as { only?: string[] }).only).toEqual(["copay", "claimed_pharmacist"]);
    expect((await read()).running?.total ?? (await read()).last.suite?.total).toBe(2 * 3);
  });

  it("allows one run at a time, across both kinds", async () => {
    session.approver = PHARMACIST;
    const run = gate();
    runners.suite.mockImplementation(async () => {
      await run.done;
      return { report: { caught: 0, broken: 0 }, resultPath: "x" };
    });
    expect((await runSuite(post())).status).toBe(202);
    expect((await runSuite(post())).status).toBe(409);
    expect((await runNight(post())).status).toBe(409);
    run.open();
    await tick();
    await tick();
    expect((await read()).running).toBeNull();
  });

  it("records a run that fails, with its reason", async () => {
    session.approver = PHARMACIST;
    runners.suite.mockRejectedValue(new Error("model failed"));
    expect((await runSuite(post())).status).toBe(202);
    await tick();
    await tick();
    const s = await read();
    expect(s.running).toBeNull();
    expect(s.last.suite).toMatchObject({ state: "failed", message: expect.stringMatching(/model failed/) });
  });
});

describe("the 60 calls an hour live cap", () => {
  it("won't start a run when the last hour has no room, and says how full it is", async () => {
    session.approver = PHARMACIST;
    usage.log = Array.from({ length: 60 }, () => JSON.stringify({ at: hourAgo(5), modelCalls: 1 })).join("\n");
    const res = await runSuite(post());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await res.json()).error).toMatch(/60/);
    expect((await read()).usage).toEqual({ used: 60, perHour: 60 });
  });

  it("counts only the last hour", async () => {
    session.approver = PHARMACIST;
    usage.log = Array.from({ length: 60 }, () => JSON.stringify({ at: hourAgo(90), modelCalls: 1 })).join("\n");
    runners.suite.mockResolvedValue({ report: { caught: 0, broken: 0 }, resultPath: "x" });
    expect((await runSuite(post())).status).toBe(202);
  });
});

describe("POST /api/arena/overnight (the overnight attacker)", () => {
  it("runs Role 3's overnight attacker into results/, 10 calls by default, counting calls as they start", async () => {
    session.approver = PHARMACIST;
    const run = gate();
    runners.night.mockImplementation(async (options: { makeSession: (...a: unknown[]) => Promise<unknown>; maxCalls: number; dir: string }) => {
      void options.makeSession; // Counting happens in the wrapped makeSession; the fake runner calls it below.
      await options.makeSession({}, {}, "000000", async () => {}).catch(() => {});
      await run.done;
      return { calls: 3, caught: 5, broken: 0, gaps: [], tactics: [], failedCalls: 0, badPlans: 0, ranAt: "", updatedAt: "" };
    });
    expect((await runNight(post())).status).toBe(202);
    await tick();
    await tick();
    const options = runners.night.mock.calls[0]![0] as { maxCalls: number; dir: string };
    expect(options.maxCalls).toBe(10);
    expect(options.dir.startsWith(dir)).toBe(true);
    expect((await read()).running).toMatchObject({ kind: "overnight", done: 1, total: 10 });
    run.open();
    await tick();
    await tick();
    expect((await read()).last.overnight).toMatchObject({ state: "done", done: 3, caught: 5, broken: 0 });
  });

  it("takes a number of calls from 1 to 60, and nothing else", async () => {
    session.approver = PHARMACIST;
    runners.night.mockResolvedValue({ calls: 0, caught: 0, broken: 0, gaps: [] });
    expect((await runNight(post({ calls: 0 }))).status).toBe(400);
    expect((await runNight(post({ calls: 61 }))).status).toBe(400);
    expect((await runNight(post({ calls: "lots" }))).status).toBe(400);
    expect((await runNight(post({ calls: 25 }))).status).toBe(202);
    await tick();
    expect((runners.night.mock.calls[0]![0] as { maxCalls: number }).maxCalls).toBe(25);
  });
});
