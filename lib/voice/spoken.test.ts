import { describe, expect, it } from "vitest";
import { digitByDigit, forSpeech, numberWords } from "./spoken";

describe("1.5: numbers rewritten for the voice", () => {
  it("says whole numbers as words", () => {
    expect(numberWords(0)).toBe("zero");
    expect(numberWords(36)).toBe("thirty-six");
    expect(numberWords(180)).toBe("one hundred and eighty");
    expect(numberWords(1005)).toBe("one thousand and five");
    expect(numberWords(2500)).toBe("two thousand five hundred");
  });

  it("reads a code digit by digit in two groups", () => {
    expect(digitByDigit("481207")).toBe("4 8 1, 2 0 7");
    expect(forSpeech("Your pharmacy verification code is 112358.")).toBe("Your pharmacy verification code is 1 1 2, 3 5 8.");
  });

  it("says money as words", () => {
    expect(forSpeech("It's $4.10 on your plan.")).toBe("It's four dollars and ten cents on your plan.");
    expect(forSpeech("The plan pays $41.20.")).toBe("The plan pays forty-one dollars and twenty cents.");
    expect(forSpeech("That's $2.")).toBe("That's two dollars.");
    expect(forSpeech("Only $0.50 today.")).toBe("Only fifty cents today.");
  });

  it("says doses as words", () => {
    expect(forSpeech("Concerta 36 mg.")).toBe("Concerta thirty-six milligrams.");
    expect(forSpeech("METFORMIN 500 MG TABLET")).toBe("METFORMIN five hundred milligrams TABLET");
    expect(forSpeech("1 mg")).toBe("one milligram");
  });

  it("leaves everything else as it is", () => {
    for (const line of ["Hi, this is Maple Street Pharmacy.", "Call 555-0101 any time.", "Take 1 tablet by mouth every morning."]) {
      expect(forSpeech(line)).toBe(line);
    }
  });
});
