import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Approver } from "@/lib/contract";
import { resetBusForTests } from "@/lib/events/bus";
import { resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { Upcoming } from "./Upcoming";

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
});

describe("the Upcoming page (2.9a)", () => {
  it("shows no patient detail to someone who isn't signed in", async () => {
    const html = renderToStaticMarkup(await Upcoming());
    expect(html).toContain("Sign in");
    expect(html).not.toMatch(/Concerta|S\.R\./);
  });

  it("shows a pharmacist the due refills with their lanes and Call now", async () => {
    session.approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
    const html = renderToStaticMarkup(await Upcoming());
    expect(html).toContain("S.R.");
    expect(html).toContain("Concerta 36 mg");
    expect(html).toContain("Quick check");
    expect(html).toContain("Call now");
    expect(html).toContain('data-testid="upcoming-strip"');
  });

  it("shows a reviewer the list without Call now", async () => {
    session.approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };
    const html = renderToStaticMarkup(await Upcoming());
    expect(html).toContain("Concerta 36 mg");
    expect(html).not.toContain("Call now");
  });
});
