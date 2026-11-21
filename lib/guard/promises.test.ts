import { describe, expect, it } from "vitest";
import { isCompletionPromise } from "./speech";

const drugs = ["Concerta", "Metformin"];

describe("S4: completion words are promises only when they're about the order", () => {
  it.each([
    "Your refill is approved.",
    "It's ready.",
    "Your Concerta is ready for pickup.",
    "The order is on its way.",
    "Your prescription has been filled.",
    "Everything is sorted.",
    "They're ready to collect.",
  ])("promise: %s", (s) => {
    expect(isCompletionPromise(s, drugs)).toBe(true);
  });

  it.each([
    "Whenever you're ready, read me the code.",
    "Are you ready for the code?",
    "I'm ready when you are.",
    "Your prescription was last filled 27 days ago.",
    "Let me know when you're ready.",
    "Thanks for calling.",
  ])("not a promise: %s", (s) => {
    expect(isCompletionPromise(s, drugs)).toBe(false);
  });
});
