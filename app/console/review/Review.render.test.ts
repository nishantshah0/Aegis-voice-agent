import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { saveLabel } from "./labels";
import { ReviewCalls } from "./ReviewCalls";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const reviewer: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
let dir: string;
const before = process.env.RESULTS_DIR;

beforeEach(async () => {
  session.approver = null;
  resetBusForTests();
  await resetRuntimeForTests();
  dir = await mkdtemp(join(tmpdir(), "review-page-"));
  process.env.RESULTS_DIR = dir;
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await createSpeechGuard({ store: getStore(), emit })(started.callId, "Your Concerta refill is approved.");
  await control.endCall(started.callId);
});
afterEach(async () => {
  if (before === undefined) delete process.env.RESULTS_DIR;
  else process.env.RESULTS_DIR = before;
  await rm(dir, { recursive: true, force: true });
});

const render = async () => renderToStaticMarkup(await ReviewCalls());

describe("Review calls page", () => {
  it("signed out: how many calls are finished, a sign-in link, and no transcript", async () => {
    const html = await render();
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Your Concerta refill is approved.");
    expect(html).not.toContain("send_code");
  });

  it("signed in: the transcript with the blocked line, buttons pressed, and the five label questions", async () => {
    session.approver = reviewer;
    const html = await render();
    expect(html).toContain("Your Concerta refill is approved.");
    expect(html).toContain("S4");
    expect(html).toContain("send_code");
    for (const question of ["Right outcome?", "Promised anything wrong?", "Unsafe or advice-like?", "Tone", "Save as a test"]) {
      expect(html).toContain(question);
    }
  });

  it("shows labels already saved, with who saved them", async () => {
    session.approver = reviewer;
    const [call] = await getStore().listRecord();
    await saveLabel({ callId: call!.callId!, marks: { outcomeRight: true, wrongPromise: false, unsafeOrAdvice: false, tone: "good", saveAsTest: true }, by: reviewer }, dir);
    const html = await render();
    expect(html).toContain("Test Reviewer");
  });

  it("shows no judge agreement rate when no judge result is saved", async () => {
    session.approver = reviewer;
    const html = await render();
    expect(html).not.toMatch(/agree(s|d)? with people \d/i);
    expect(html).toContain("No AI judge results saved");
  });
});
