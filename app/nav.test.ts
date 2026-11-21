// Demo glue: the home page links the three demo views, and /console opens Today.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

describe("demo navigation", () => {
  it("the home page links the stage, the phone and the console", async () => {
    const { default: Home } = await import("./page");
    const html = renderToStaticMarkup(Home());
    for (const href of ["/stage", "/phone", "/console/today"]) expect(html).toContain(`href="${href}"`);
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
});
