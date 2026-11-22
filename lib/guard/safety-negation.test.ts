// RT-SAFE-1 (Trail #86): a plain "I'm not suicidal" isn't a crisis; anything less plain stays
// one (false alarms are acceptable). Handover and emergency wording that isn't one stays ordinary.
import { describe, expect, it } from "vitest";
import { classify } from "./safety";

const action = (line: string) => classify(line).action;

describe("plain negations", () => {
  it.each(["I'm not suicidal, I just need my refill.", "I'm not going to hurt myself.", "I would never kill myself.", "No thoughts of suicide."])("%j continues", (line) => {
    expect(action(line)).toBe("continue");
  });

  it.each(["I'm not suicidal but I want to die.", "I'm not sure I want to live.", "I don't know if I'm suicidal.", "Not suicidal, just want to end it all."])("%j is still a crisis", (line) => {
    expect(action(line)).toBe("crisis");
  });
});

describe("words that aren't a safety line", () => {
  it.each([
    "That's odd.",
    "The pharmacist said to take it with food.",
    "Let's end it here for today.",
    "I took one of my Concerta this morning.",
    "Can you hold on a second?",
    "Is this the right person to ask about delivery?",
    "My dog is barking, sorry.",
  ])("%j continues", (line) => {
    expect(action(line)).toBe("continue");
  });
});

describe("other ways to say it", () => {
  it.each([
    ["Mujhe saans nahi aa rahi.", "emergency"],
    ["Main marna chahta hoon.", "crisis"],
    ["I O.D.'d last night.", "emergency"],
    ["My toddler got into the pill bottle.", "emergency"],
    ["Transfer me to the pharmacist.", "handover"],
  ])("%j is %s", (line, want) => {
    expect(action(line)).toBe(want);
  });
});
