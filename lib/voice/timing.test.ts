import { describe, expect, it } from "vitest";
import { createPhoneTiming, median } from "./timing";

describe("1.6: turn timing on the phone", () => {
  it("takes the median of odd and even counts, and nothing of none", () => {
    expect(median([900, 300, 1200])).toBe(900);
    expect(median([1000, 800, 1400, 600])).toBe(900);
    expect(median([])).toBeUndefined();
  });

  it("times each turn from the caller stopping to the first line and to speech", () => {
    let t = 0;
    const timing = createPhoneTiming(() => t);
    timing.callerStopped();
    t = 700;
    timing.agentLine();
    t = 900;
    timing.speechStarted();
    t = 950;
    timing.agentLine(); // A second line in the same turn doesn't move the mark.
    expect(timing.turns()).toEqual([{ firstLineMs: 700, speechStartedMs: 900 }]);
  });

  it("uses speech started when spoken, else the first line, for the median", () => {
    let t = 0;
    const timing = createPhoneTiming(() => t);
    timing.callerStopped();
    t = 1100;
    timing.agentLine();
    t = 1300;
    timing.speechStarted();
    t = 2000;
    timing.callerStopped();
    t = 2600;
    timing.agentLine(); // Typed: no speech.
    expect(timing.medianMs()).toBe(950);
  });

  it("ignores lines before the caller has said anything (the opener)", () => {
    const timing = createPhoneTiming(() => 5);
    timing.agentLine();
    timing.speechStarted();
    expect(timing.turns()).toEqual([]);
    expect(timing.medianMs()).toBeUndefined();
  });
});
