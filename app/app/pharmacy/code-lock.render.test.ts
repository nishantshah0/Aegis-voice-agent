import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClearLock } from "./_parts/ClearLock";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// Trail #86: the lockout control a pharmacist sees on Upcoming and the call page.
describe("ClearLock", () => {
  const props = { patientId: "p_sam", who: "S.R.", lockedUntil: "2026-11-24T15:15:00.000Z" };

  it("shows when the lock ends, on the pharmacy's clock, and a Clear lockout button for a pharmacist", () => {
    const html = renderToStaticMarkup(createElement(ClearLock, { ...props, canClear: true }));
    expect(html).toContain("Locked until Nov 24, 10:15");
    expect(html).toContain("Clear lockout");
  });

  it("shows the lock but no button to anyone else", () => {
    const html = renderToStaticMarkup(createElement(ClearLock, { ...props, canClear: false }));
    expect(html).toContain("Locked until");
    expect(html).not.toContain("Clear lockout");
    expect(html).toContain("Only a pharmacist can clear it");
  });
});
