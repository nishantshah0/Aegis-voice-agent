import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approver } from "@/lib/contract";
import { createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { Calls } from "./CallsView";

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

beforeEach(async () => {
  session.approver = null;
  resetBusForTests();
  await resetRuntimeForTests();
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
  await createSpeechGuard({ store: getStore(), emit })(started.callId, "Your Concerta refill is approved.");
});

describe("the Calls page (2.9b)", () => {
  it("shows nothing about calls to someone who isn't signed in", async () => {
    const html = renderToStaticMarkup(await Calls());
    expect(html).toContain("Sign in");
    expect(html).not.toMatch(/Concerta|S\.R\.|send code/);
  });

  it("shows staff the calls, presses, blocked lines and the verified record, and no confidence score", async () => {
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    const html = renderToStaticMarkup(await Calls());
    expect(html).toContain("S.R.");
    expect(html).toContain("send code");
    // Sam isn't verified yet, so the guard blocks naming his drug (S1); any blocked line shows struck, with its replacement.
    expect(html).toMatch(/line-through">Your Concerta refill is approved\.</);
    expect(html).toContain("Said instead:");
    expect(html).toContain("Record chain verified");
    expect(html).not.toMatch(/confidence/i);
  });
});
