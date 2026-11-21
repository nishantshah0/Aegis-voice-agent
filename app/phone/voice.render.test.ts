import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceBar } from "./Phone";
import { newAgentLines } from "./useVoice";

const noop = () => {};

describe("1.5: voice on the phone", () => {
  it("speaks only the agent's lines that arrived since it last spoke", () => {
    const items = [
      { kind: "line" as const, who: "agent" as const, text: "Hello." },
      { kind: "line" as const, who: "caller" as const, text: "Hi." },
      { kind: "blocked" as const, rule: "S4" as const, original: "Approved.", replacement: "A pharmacist will check it first." },
      { kind: "line" as const, who: "agent" as const, text: "A pharmacist will check it first." },
    ];
    expect(newAgentLines(items, 0)).toEqual(["Hello.", "A pharmacist will check it first."]);
    // Never the blocked original: only what the guard let through.
    expect(newAgentLines(items, 1)).toEqual(["A pharmacist will check it first."]);
  });

  it("offers voice, then shows listening, speaking and the hold button", () => {
    const off = renderToStaticMarkup(createElement(VoiceBar, { on: false, mode: "open", hearing: "", speaking: false, onToggle: noop, onMode: noop, onHoldDown: noop, onHoldUp: noop }));
    expect(off).toContain("Use voice");
    expect(off).not.toContain("Hold to talk");
    const listening = renderToStaticMarkup(createElement(VoiceBar, { on: true, mode: "open", hearing: "yes plea", speaking: false, onToggle: noop, onMode: noop, onHoldDown: noop, onHoldUp: noop }));
    expect(listening).toContain("Hearing: yes plea");
    const speaking = renderToStaticMarkup(createElement(VoiceBar, { on: true, mode: "hold", hearing: "", speaking: true, onToggle: noop, onMode: noop, onHoldDown: noop, onHoldUp: noop }));
    expect(speaking).toContain("Pharmacy speaking");
    expect(speaking).toMatch(/<button[^>]*disabled=""[^>]*>Hold to talk<\/button>/);
  });
});

describe("1.6: the median turn on the phone", () => {
  it("shows nothing until a turn is timed, then the median against the target", async () => {
    const { TurnTime } = await import("./Phone");
    expect(renderToStaticMarkup(createElement(TurnTime, {}))).toBe("");
    const fast = renderToStaticMarkup(createElement(TurnTime, { medianMs: 940 }));
    expect(fast).toContain("Median turn 0.94 s (target 1.2 s)");
    expect(fast).toContain("text-green-700");
    expect(renderToStaticMarkup(createElement(TurnTime, { medianMs: 1600 }))).toContain("text-amber-700");
  });
});
