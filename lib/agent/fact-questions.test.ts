import { describe, expect, it } from "vitest";
import { factQuestion, newFactContext } from "./fact-questions";

const prescriptions = [{ rx_id: "rx_a", drug: "Concerta" }, { rx_id: "rx_b", drug: "Metformin" }];

describe("verified fact questions", () => {
  it("asks which Rx, remembers the question, and handles a drug or duration correction", () => {
    const state = newFactContext();
    state.prescriptions = prescriptions;
    expect(factQuestion(state, "When did I last fill it, and how much will I pay for 7 days?")).toMatchObject({ line: expect.stringContaining("Which prescription") });
    expect(factQuestion(state, "My metformin")).toMatchObject({ rxId: "rx_b", history: true, coverage: true, days: 7 });
    expect(factQuestion(state, "No, the other one")).toMatchObject({ rxId: "rx_a", days: 7 });
    expect(factQuestion(state, "Actually, make that two weeks")).toMatchObject({ rxId: "rx_a", days: 14 });
  });

  it("recognizes varied phrasing and never guesses between duplicate or unknown drugs", () => {
    const state = newFactContext();
    state.prescriptions = prescriptions;
    for (const text of ["How many tablets did I get last time for Metformin?", "When did I last get my Metformin filled?", "How many refills are left on my Metformin?"]) {
      expect(factQuestion(state, text), text).toMatchObject({ history: true, rxId: "rx_b" });
    }
    expect(factQuestion(state, "And what's my share on insurance for Metformin?")).toMatchObject({ coverage: true, rxId: "rx_b" });
    state.prescriptions = [{ rx_id: "rx_other", drug: "Metformin" }, prescriptions[1]];
    expect(factQuestion(state, "What's my copay for Metformin?")).toMatchObject({ line: expect.any(String) });
    state.prescriptions = [prescriptions[1]];
    expect(factQuestion(state, "What's my copay for Unlistedmed?")?.rxId).toBeUndefined();
  });

  it("preserves unrelated requests and avoids past-payment, bill-balance or third-party guesses", () => {
    const state = newFactContext();
    state.prescriptions = [prescriptions[1]];
    for (const text of ["Refill my Metformin and tell me the copay.", "What's my copay and can I book an appointment?", "What is the price and when can I take it?", "How much is it and sing me a song?"]) {
      expect(factQuestion(state, text), text).toBeUndefined();
    }
    // "How much did I pay" is a copay question now (1.x, Trail #75): see below. A bill, a balance or a payment history still isn't.
    for (const text of ["What is my bill balance?", "What's my payment history?", "What was I charged last month?", "What's my wife's copay?", "What does a 2.5-day supply cost?", "How much for minus seven days?", "Price for influenza medication?"]) {
      const reply = factQuestion(state, text);
      expect(reply?.rxId, text).toBeUndefined();
    }
  });

  it("1.x: 'how much did I pay', 'what was my copay', 'what does it cost me' get the coverage read-back", () => {
    // Nishant: these are copay questions, answered with check_coverage's coverage_readback,
    // which states the plan's split, never a past charge.
    for (const text of ["How much did I pay?", "How much did I pay last time?", "What was my copay?", "What does it cost me?", "How much do I pay for it?"]) {
      const state = newFactContext();
      state.prescriptions = [prescriptions[1]];
      expect(factQuestion(state, text), text).toMatchObject({ coverage: true, rxId: "rx_b" });
    }
  });

  it("1.x: a self-corrected supply length uses the last value said after the correction", () => {
    const cases: [string, number][] = [
      ["How much for two weeks, sorry, one week?", 7],
      ["What's the price for a month, no, two weeks?", 14],
      ["How much for 10 days, I mean 14 days?", 14],
      ["What would one week cost, actually two weeks?", 14],
      ["Price for two weeks, wait, one week?", 7],
    ];
    for (const [text, days] of cases) {
      const state = newFactContext();
      state.prescriptions = [prescriptions[1]];
      expect(factQuestion(state, text), text).toMatchObject({ coverage: true, rxId: "rx_b", days });
    }
  });

  it("1.x: still asks how many days when two lengths come with no correction", () => {
    // "A month" isn't a whole number of days to quote, so it asks too.
    for (const text of ["How much for one week or two weeks?", "What's the price for 7 days and 14 days?", "What's the price for a month?"]) {
      const state = newFactContext();
      state.prescriptions = [prescriptions[1]];
      expect(factQuestion(state, text), text).toMatchObject({ line: "How many whole days of medication should I check the price for?" });
    }
  });
});
