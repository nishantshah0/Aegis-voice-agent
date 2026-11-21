import { describe, expect, it } from "vitest";
import { scrollToEnd } from "./scroll";

describe("1.4: scrolling the transcript never returns a value to React", () => {
  it("returns nothing even when scrollIntoView returns a Promise (newer Chrome)", () => {
    let called = false;
    const el = {
      scrollIntoView: (opts: unknown) => {
        called = true;
        expect(opts).toEqual({ block: "end" });
        return Promise.resolve();
      },
    };
    expect(scrollToEnd(el)).toBeUndefined();
    expect(called).toBe(true);
  });

  it("is fine with no element yet", () => {
    expect(scrollToEnd(null)).toBeUndefined();
  });
});
