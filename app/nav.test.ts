// Demo glue: the home page signs you in to the dashboard and links its two product areas and
// the phone; the old URLs still land in the right place.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

describe("demo navigation", () => {
  it("the home page links sign-in, both product areas and the phone", async () => {
    const { default: Home } = await import("./page");
    const html = renderToStaticMarkup(Home());
    for (const href of ["/dashboard/calls", "/dashboard/suite", "/phone", "/api/auth/login?returnTo=%2Fdashboard"]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain("Pages coming");
  });

  it("/console redirects to the Today page", async () => {
    const { default: Console } = await import("./console/page");
    let digest = "";
    try {
      Console();
    } catch (error) {
      digest = String((error as { digest?: string }).digest ?? "");
    }
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/console/today");
  });

  it("old URLs redirect into the dashboard; /phone stays the device", async () => {
    const { default: config } = await import("../next.config");
    const redirects = await config.redirects!();
    const to = (source: string) => redirects.find((r) => r.source === source)?.destination;
    expect(to("/console")).toBe("/dashboard/calls");
    expect(to("/console/today")).toBe("/dashboard/calls");
    expect(to("/console/upcoming")).toBe("/dashboard/calls/upcoming");
    expect(to("/console/calls")).toBe("/dashboard/calls/history");
    expect(to("/console/review")).toBe("/dashboard/calls/review");
    expect(to("/console/overnight")).toBe("/dashboard/suite/overnight");
    expect(to("/console/rules")).toBe("/dashboard/suite/rules");
    expect(to("/stage")).toBe("/dashboard/suite/live");
    expect(to("/app")).toBe("/dashboard");
    expect(to("/phone")).toBeUndefined();
    // Only exact pages move: the review page's label route and every API route stay put.
    expect(redirects.some((r) => r.source.startsWith("/api") || r.source.startsWith("/console/review/"))).toBe(false);
  });
});
