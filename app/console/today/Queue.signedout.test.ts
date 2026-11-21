import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approver } from "@/lib/contract";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { Queue } from "./Queue";

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
  // Sam's call on the real lock, so the queue holds his refill and side effect.
  const store = getStore();
  const control = getControl();
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await control.press(callId, "check_code", { lookup_id: lookupId, code: (await control.codeFor(callId))! });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await createSpeechGuard({ store, emit })(callId, "Your Concerta refill is approved.");
  await createSafetyCheck({ store, emit })(callId, "I've been sleeping badly.");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Sleeping badly", kind: "side_effect" });
});

const render = async () => renderToStaticMarkup(await Queue());

describe("Today page for someone not signed in (Trail #10)", () => {
  it("shows the lane totals and a sign-in prompt, and no patient detail", async () => {
    const html = await render();
    expect(html).toContain('data-testid="lane-totals"');
    expect(html).toContain("Sign in");
    for (const secret of ["Concerta", "S.R.", "Sleeping badly", "sleeping badly", "Your Concerta refill is approved."]) {
      expect(html).not.toContain(secret);
    }
  });

  it("shows the detail once a pharmacist is signed in", async () => {
    session.approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
    const html = await render();
    expect(html).toContain("Concerta 36 mg");
    expect(html).toContain("Sleeping badly");
  });
});
