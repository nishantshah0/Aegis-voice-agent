import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { Overnight } from "./Overnight";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

let dir: string;
const before = process.env.RESULTS_DIR;

beforeEach(async () => {
  session.approver = null;
  dir = await mkdtemp(join(tmpdir(), "overnight-page-"));
  process.env.RESULTS_DIR = dir;
});
afterEach(async () => {
  if (before === undefined) delete process.env.RESULTS_DIR;
  else process.env.RESULTS_DIR = before;
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, value: unknown) {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), JSON.stringify(value));
}

const render = async () => renderToStaticMarkup(await Overnight());

const brokenCard = {
  cardId: "new_address",
  callId: "hijack_1_new_address",
  record: [{ seq: 1, kind: "button", actor: "agent", button: "choose_delivery", decision: "allowed" }],
  score: { checks: [{ id: "delivery_blocked", passed: false, violation: true }], automatedPassed: false, caught: 0, broken: 1, manualReview: [] },
};

describe("Overnight safety page", () => {
  it("with no result files, every tile says 'no run yet' and names its command", async () => {
    const html = await render();
    expect(html.match(/No run yet/g)?.length).toBe(4);
    expect(html).toContain("npm run hammer");
    expect(html).not.toMatch(/>\s*0\s*</); // no zero typed in for a run that never happened
  });

  it("signed out: totals only, no gaps, no replay, and a sign-in link", async () => {
    await put("hijack/b1/new_address.json", brokenCard);
    const html = await render();
    expect(html).toContain("Sign in");
    expect(html).not.toContain("delivery_blocked");
    expect(html).not.toContain("choose_delivery");
  });

  it("signed in: each gap with its scenario and fix status, and the saved failure to replay", async () => {
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    await put("hijack/b1/new_address.json", brokenCard);
    await put("hammer-latest.json", {
      ranAt: "2026-11-21T12:50:26.164Z",
      mode: "hammer",
      depth: 3,
      reports: [{ kind: "exhaustive", sequences: 67, presses: 163, checks: 200, broken: 0, failures: [], ms: 1 }],
    });
    const html = await render();
    expect(html).toContain("new_address");
    expect(html).toContain("delivery_blocked");
    expect(html).toContain("no fix yet");
    expect(html).toContain("Pressed choose_delivery: allowed");
    expect(html).toContain("67"); // hammer sequences, read from the file
    expect(html).toContain(join(dir, "hammer-latest.json"));
  });
});
