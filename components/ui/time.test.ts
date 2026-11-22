// The app's one date format: relative in the text, absolute on hover, pharmacy time zone.
import { describe, expect, it } from "vitest";
import { absoluteTime, relativeTime, shortTime } from "./time";

const NOW = Date.parse("2026-11-24T15:00:00Z"); // Tue Nov 24, 10:00 AM in Toronto

describe("relativeTime", () => {
  it("says recent times relative to now", () => {
    expect(relativeTime("2026-11-24T14:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-11-24T14:58:00Z", NOW)).toBe("2 min ago");
    expect(relativeTime("2026-11-24T12:00:00Z", NOW)).toBe("3 h ago");
  });

  it("names yesterday and the last few days with the clock time", () => {
    expect(relativeTime("2026-11-23T19:10:00Z", NOW)).toBe("Yesterday, 2:10 PM");
    expect(relativeTime("2026-11-21T14:05:00Z", NOW)).toBe("Sat, 9:05 AM");
  });

  it("prints older times as a date, with the year only when it differs", () => {
    expect(relativeTime("2026-07-21T11:30:21Z", NOW)).toBe("Jul 21");
    expect(relativeTime("2025-07-21T11:30:21Z", NOW)).toBe("Jul 21, 2025");
  });

  it("prints a time ahead of now as an absolute time, never 'in 2 days'", () => {
    expect(relativeTime("2026-11-26T15:00:00Z", NOW)).toBe("Nov 26, 10:00 AM");
  });

  it("prints nothing for a missing or broken time", () => {
    expect(relativeTime("", NOW)).toBe("");
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("absolute times", () => {
  it("gives the full time for the hover title, in the pharmacy's zone", () => {
    expect(absoluteTime("2026-11-24T15:00:00Z")).toBe("Tue, Nov 24, 2026, 10:00 AM EST");
  });
  it("gives a short time for table columns", () => {
    expect(shortTime("2026-11-24T15:00:00Z")).toBe("Nov 24, 10:00 AM");
  });
});
