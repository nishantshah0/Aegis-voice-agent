// Demo glue: the home page signs you in and links the two product areas and the phone;
// the old console URLs still land in the right place.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

describe("demo navigation", () => {
  it("the home page links sign-in, both product areas and the phone", async () => {
    const { default: Home } = await import("./page");
    const html = renderToStaticMarkup(Home());
    for (const href of ["/app/pharmacy/today", "/app/safety/gate", "/phone", "/api/auth/login?returnTo=%2Fapp"]) expect(html).toContain(`href="${href}"`);
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

  it("old console URLs redirect into the app; /stage and /phone stay where they are", async () => {
    const { default: config } = await import("../next.config");
    const redirects = await config.redirects!();
    const to = (source: string) => redirects.find((r) => r.source === source)?.destination;
    expect(to("/console/today")).toBe("/app/pharmacy/today");
    expect(to("/console/upcoming")).toBe("/app/pharmacy/upcoming");
    expect(to("/console/calls")).toBe("/app/pharmacy/calls");
    expect(to("/console/review")).toBe("/app/pharmacy/review");
    expect(to("/console/rules")).toBe("/app/safety/rules");
    expect(to("/console/overnight")).toBe("/app/safety/overnight");
    expect(to("/stage")).toBeUndefined();
    expect(to("/phone")).toBeUndefined();
  });
});
