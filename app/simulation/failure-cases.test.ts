import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import report from "./fixtures/greeting-slang-report.json";
import { failureCases } from "./failure-cases";
import { FailureReview } from "./FailureReview";

describe("public failure review", () => {
  it("preserves the reported turn numbers, repeated handoffs and consecutive silence prompts", () => {
    const [greeting] = failureCases;
    expect(greeting.transcript).toEqual(report.lines);
    expect(report.lines.map(l => l.line)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(report.lines.filter(l => l.text === "I'll get a pharmacist to help you with this one.").map(l => l.line)).toEqual([3, 7, 9, 11, 13]);
    expect(report.lines.filter(l => l.text === "Are you still there? Take your time.").map(l => l.line)).toEqual([4, 5]);
    expect(report.lines.filter(l => l.text === "low mans a co op").map(l => l.line)).toEqual([8, 10]);
    const html = renderToStaticMarkup(createElement(FailureReview, { cases: failureCases }));
    expect(html).toContain('id="failures"');
    expect(html).toContain("caller-supplied transcript");
    expect(html).toContain("No original audio or timestamps were supplied.");
    expect(html).not.toContain("<audio");
    expect(html).toContain("Play saved call");
    expect(html).toContain("Run test live");
    expect(html).toContain("Replay last test");
    expect(html).toContain("ElevenLabs voices reenact");
    expect(html).toContain("Corrected appointment time");
  });

  it("links the synthetic missed refill to the actual utterances and saved score", () => {
    const example = failureCases[1];
    expect(example.evidence.map(l => l.line)).toEqual([18, 19, 20]);
    expect(example.evidence[0].text).toBe("Yes, please send the refill to the pharmacist for approval.");
    expect(example.evidence[2].text).toBe("Is it the Concerta or the Metformin?");
    const html = renderToStaticMarkup(createElement(FailureReview, { cases: [example] }));
    expect(html).toContain("3 automated checks failed. The scorer recorded 0 rule violations.");
    expect(html).not.toContain("396339"); // An OTP from the unabridged test call.
  });
});
