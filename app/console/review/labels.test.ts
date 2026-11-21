import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { judgeAgreement, latestLabels, readLabels, saveLabel, type Label } from "./labels";
import { POST } from "./labels/route";

const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const reviewer: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const marks = { outcomeRight: true, wrongPromise: false, unsafeOrAdvice: false, tone: "good" as const, saveAsTest: false };

let dir: string;
const before = process.env.RESULTS_DIR;
beforeEach(async () => {
  session.approver = null;
  dir = await mkdtemp(join(tmpdir(), "labels-"));
  process.env.RESULTS_DIR = dir;
});
afterEach(async () => {
  if (before === undefined) delete process.env.RESULTS_DIR;
  else process.env.RESULTS_DIR = before;
  await rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  POST(new Request("http://localhost/console/review/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("labels file", () => {
  it("appends each label under results/labels/ and reads them back", async () => {
    await saveLabel({ callId: "c_1", marks, by: reviewer, note: "fine" }, dir);
    const file = await readFile(join(dir, "labels", "labels.jsonl"), "utf8");
    expect(file.trim().split("\n")).toHaveLength(1);
    const [label] = await readLabels(dir);
    expect(label).toMatchObject({ callId: "c_1", marks, by: reviewer, note: "fine" });
    expect(Date.parse(label!.at)).not.toBeNaN();
  });

  it("keeps each labeller's newest label per call", async () => {
    await saveLabel({ callId: "c_1", marks, by: reviewer }, dir);
    await saveLabel({ callId: "c_1", marks: { ...marks, outcomeRight: false }, by: reviewer }, dir);
    await saveLabel({ callId: "c_1", marks, by: pharmacist }, dir);
    const latest = latestLabels(await readLabels(dir));
    expect(latest.get("c_1")).toHaveLength(2);
    expect(latest.get("c_1")!.find((l) => l.by.id === reviewer.id)!.marks.outcomeRight).toBe(false);
  });

  it("returns no labels when the file doesn't exist", async () => {
    expect(await readLabels(dir)).toEqual([]);
  });
});

describe("POST /console/review/labels", () => {
  it("refuses anyone not signed in as a pharmacist or reviewer", async () => {
    const res = await post({ callId: "c_1", marks });
    expect(res.status).toBe(401);
    expect(await readLabels(dir)).toEqual([]);
  });

  it("takes the labeller from the Auth0 session, never from the request", async () => {
    session.approver = reviewer;
    const res = await post({ callId: "c_1", marks, by: { id: "auth0|someone-else", name: "Mallory", role: "pharmacist" } });
    expect(res.status).toBe(200);
    const [label] = await readLabels(dir);
    expect(label!.by).toEqual(reviewer);
  });

  it("rejects a malformed label", async () => {
    session.approver = reviewer;
    expect((await post({ callId: "", marks })).status).toBe(400);
    expect((await post({ callId: "c_1", marks: { ...marks, tone: "shouty" } })).status).toBe(400);
    expect(await readLabels(dir)).toEqual([]);
  });
});

describe("judgeAgreement", () => {
  const label = (callId: string, m: Partial<Label["marks"]>): Label => ({ callId, marks: { ...marks, ...m }, by: reviewer, at: "2026-11-21T10:00:00Z" });

  it("is null when no judge result is saved", async () => {
    expect(await judgeAgreement([label("c_1", {})], dir)).toBeNull();
  });

  it("compares people's labels with saved judge results and lists the disagreements", async () => {
    await mkdir(join(dir, "arena", "judge"), { recursive: true });
    await writeFile(
      join(dir, "arena", "judge", "run-1.json"),
      JSON.stringify([
        { callId: "c_1", outcomeRight: true, wrongPromise: false, unsafeOrAdvice: false },
        { callId: "c_2", outcomeRight: true, unsafeOrAdvice: true },
        { callId: "c_unlabelled", outcomeRight: false },
      ]),
    );
    const result = await judgeAgreement([label("c_1", {}), label("c_2", { unsafeOrAdvice: false })], dir);
    // c_1: 3 compared, 3 agree. c_2: outcomeRight agrees, unsafeOrAdvice disagrees. c_unlabelled: nothing to compare.
    expect(result).toMatchObject({ compared: 5, agreed: 4 });
    expect(result!.disagreements).toEqual([{ callId: "c_2", mark: "unsafeOrAdvice", judge: true, people: false }]);
  });
});
