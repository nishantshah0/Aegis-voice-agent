import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard, parseEntry, readAttempts, readCards, readLatestBatch, readLatestRun, readWhy, rowsFor, whyGroup } from "./data";

const tmp = () => mkdtemp(join(tmpdir(), "suite-"));
const put = async (path: string, json: unknown) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(json));
};

const board = (passed: boolean) => ({
  totalScenarios: 28,
  completed: false,
  passed: passed ? 1 : 0,
  caught: 2,
  broken: passed ? 0 : 1,
  scenarios: [
    {
      id: "copay",
      group: "ordinary_patients",
      passed,
      attempts: [{ callId: "c_0001", automatedPassed: passed, caught: 2, broken: passed ? 0 : 1, checks: [{ id: "no_refill", passed, violation: true }], manualReview: ["q?"] }],
    },
  ],
});

describe("safety suite data", () => {
  it("reads the real scenario cards, 28 of them in the fixed suite", async () => {
    const cards = await readCards(join(process.cwd(), "scenarios"));
    expect(cards.filter((c) => c.inSuite)).toHaveLength(28);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("marks regression and attacker cards as outside the suite", () => {
    expect(parseCard({ id: "a", source: "team", suite: "regression" }, "a.json")?.inSuite).toBe(false);
    expect(parseCard({ id: "b", source: "attacker" }, "b.json")?.inSuite).toBe(false);
    expect(parseCard({ id: "c", source: "team" }, "c.json")?.inSuite).toBe(true);
    expect(parseCard({ nope: true }, "d.json")).toBeNull();
  });

  it("returns no run when nothing is saved", async () => {
    expect(await readLatestRun(await tmp())).toBeNull();
  });

  it("picks the newest scoreboard and joins it to the cards", async () => {
    const dir = await tmp();
    const root = join(dir, "arena", "scenarios");
    await put(join(root, "old", "scoreboard.json"), board(true));
    await utimes(join(root, "old", "scoreboard.json"), new Date(1_000), new Date(1_000));
    await put(join(root, "new", "scoreboard.json"), board(false));
    const run = await readLatestRun(dir);
    expect(run?.runId).toBe("new");
    expect(run?.runs).toBe(2);
    const cards = [parseCard({ id: "copay", source: "team" }, "copay.json")!, parseCard({ id: "other", source: "team" }, "other.json")!];
    const rows = rowsFor(cards, run);
    expect(rows.map((r) => r.status)).toEqual(["failed", "not_run"]);
    expect(rows[0]?.broken).toBe(1);
    expect(rows[0]?.attempts[0]?.manualReview).toEqual(["q?"]);
  });

  it("reads attempt files from either layout", async () => {
    const dir = await tmp();
    const root = join(dir, "arena", "scenarios", "r1");
    await put(join(root, "scoreboard.json"), board(true));
    const record = [{ seq: 1, kind: "caller_line", actor: "caller", input: { text: "hi" }, decision: "allowed", hash: "h1", prevHash: "0" }];
    await put(join(root, "runs", "copay-1.json"), { callId: "c_0001", record, score: { automatedPassed: true, checks: [] } });
    await put(join(root, "attempts", "copay", "2.json"), { callId: "c_0002", record, score: { automatedPassed: false, checks: [] } });
    await put(join(root, "runs", "copay_two-1.json"), { callId: "x", record });
    const run = (await readLatestRun(dir))!;
    const files = await readAttempts(run, "copay");
    expect(files.map((f) => [f.n, f.callId, f.score?.passed])).toEqual([
      [1, "c_0001", true],
      [2, "c_0002", false],
    ]);
  });

  it("keeps blocked lines and presses readable, without internal fields", () => {
    const blocked = parseEntry({ kind: "line_blocked", input: { text: "It's approved." }, output: { rule: "S4", replacement: "A pharmacist will check.", why: "completion" }, decision: "blocked" });
    expect(blocked).toMatchObject({ rule: "S4", ruleIds: ["S4"], text: "It's approved.", replacement: "A pharmacist will check." });
    const press = parseEntry({ kind: "button", button: "lookup_patient", input: { name: "Sam" }, output: { result: { ok: true }, internal: { codeHash: "secret" } }, decision: "allowed" });
    expect(press.result).toEqual({ ok: true });
    expect(JSON.stringify(press)).not.toContain("codeHash");
  });

  it("reads why each rule exists from results/why/", async () => {
    const dir = await tmp();
    await put(join(dir, "why", "index.json"), { generatedAt: "2026-11-21T00:00:00Z", missing: [], records: [{ id: "S4", title: "S4", status: "checkpoint" }, { id: "../evil", title: "x" }] });
    await put(join(dir, "why", "S4.json"), { id: "S4", file: "lib/guard/speech.ts", line: 226, content: "if (x)", commit: "05ecce4f", agent: "Claude Code" });
    const why = await readWhy(dir);
    expect(why?.records).toHaveLength(1);
    expect(why?.records[0]).toMatchObject({ id: "S4", file: "lib/guard/speech.ts", line: 226, commit: "05ecce4f", agent: "Claude Code" });
    expect(await readWhy(await tmp())).toBeNull();
    expect([whyGroup("rule-1"), whyGroup("S2"), whyGroup("card-4b"), whyGroup("hijack-driver")]).toEqual(["Core rules", "Speech rules", "Attack cards", "The hijack"]);
  });

  it("reads the newest full hijack batch and skips a judge's single pick", async () => {
    const dir = await tmp();
    const card = (cardId: string, caught: number) => ({ cardId, callId: "c_0001", record: [], score: { automatedPassed: true, caught, broken: 0, checks: [] } });
    await put(join(dir, "hijack", "2026-11-21T10-00-00Z", "early_refill.json"), card("early_refill", 3));
    await put(join(dir, "hijack", "2026-11-21T10-00-00Z", "cross_patient.json"), card("cross_patient", 2));
    await put(join(dir, "hijack", "pick-2026-11-21T11-00-00Z", "hijack_pick_1_early_refill.json"), { tag: "x", record: [] });
    const batch = await readLatestBatch(dir);
    expect(batch?.cards).toBe(2);
    expect(batch?.caught).toBe(5);
    expect(batch?.batches).toBe(1);
    expect(await readLatestBatch(await tmp())).toBeNull();
  });

  it("takes the newest batch by its folder name when file times are equal (a fresh checkout)", async () => {
    const dir = await tmp();
    const card = (cardId: string, caught: number) => ({ cardId, callId: "c_0001", record: [], score: { automatedPassed: true, caught, broken: 0, checks: [] } });
    await put(join(dir, "hijack", "2026-11-22T00-08-58-709Z", "early_refill.json"), card("early_refill", 9));
    await put(join(dir, "hijack", "2026-11-21T11-22-05-794Z", "early_refill.json"), card("early_refill", 2));
    for (const b of ["2026-11-22T00-08-58-709Z", "2026-11-21T11-22-05-794Z"]) await utimes(join(dir, "hijack", b, "early_refill.json"), new Date(5_000_000), new Date(5_000_000));
    expect((await readLatestBatch(dir))?.caught).toBe(9);
  });
});
