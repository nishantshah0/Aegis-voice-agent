import { describe, expect, it } from "vitest";
import { createSentenceSplitter } from "./sentences";

function split(chunks: string[]): string[] {
  const s = createSentenceSplitter();
  return [...chunks.flatMap((c) => s.push(c)), ...s.flush()];
}

describe("1.2: sentence splitter", () => {
  it("gives each sentence once it is complete, across chunks", () => {
    const s = createSentenceSplitter();
    expect(s.push("Hi Sam")).toEqual([]);
    expect(s.push(". How are")).toEqual(["Hi Sam."]);
    expect(s.push(" you")).toEqual([]);
    expect(s.push("? ")).toEqual(["How are you?"]);
    expect(s.flush()).toEqual([]);
  });

  it("keeps prices, decimals and titles inside a sentence", () => {
    expect(split(["It costs $4.10 on your plan. ", "Dr. Patel signed it."])).toEqual(["It costs $4.10 on your plan.", "Dr. Patel signed it."]);
  });

  it("splits on line breaks and flushes the last unfinished sentence", () => {
    expect(split(["One moment\nI'll check", " that for you"])).toEqual(["One moment", "I'll check that for you"]);
  });

  it("ends with nothing when the turn had no text", () => {
    expect(split([])).toEqual([]);
    expect(split(["   "])).toEqual([]);
  });
});
