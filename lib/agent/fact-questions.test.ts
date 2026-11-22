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
    for (const text of ["What is my bill balance?", "How much did I pay last time?", "What's my wife's copay?", "What does a 2.5-day supply cost?", "How much for minus seven days?", "Price for influenza medication?"]) {
      const reply = factQuestion(state, text);
      expect(reply?.rxId, text).toBeUndefined();
    }
  });
});
