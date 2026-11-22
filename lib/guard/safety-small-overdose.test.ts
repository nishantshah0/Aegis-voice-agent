// Trail #86 review low: a possible small overdose ("I might have taken an extra one") gets a
// pharmacist, not the 911 script; with a symptom it's still an emergency. Honest dose talk
// continues. Wordings already pinned as emergencies ("I took two doses by mistake", "I think I
// doubled up") stay emergencies: over-triggering is the safe direction.
import { describe, expect, it } from "vitest";
import { classify } from "./safety";

const action = (line: string) => classify(line).action;

describe("a possible small overdose goes to a pharmacist", () => {
  it.each([
    "I might have taken an extra one.",
    "I think I took two by mistake.",
    "I double-dosed.",
    "I double dosed this morning.",
    "I accidentally took another one.",
    "I took one too many.",
    "I forgot I already took it and took it again.",
    "I took my Concerta again by accident.",
    "I took an extra dose.",
  ])("%j is a handover", (line) => {
    expect(action(line)).toBe("handover");
  });

  it.each(["I took an extra one and now my chest hurts.", "I double-dosed and I can barely breathe.", "I might have taken an extra one, I feel faint."])("%j, with a symptom, is an emergency", (line) => {
    expect(action(line)).toBe("emergency");
  });

  it.each(["I took two doses by mistake.", "I think I doubled up."])("%j stays an emergency", (line) => {
    expect(action(line)).toBe("emergency");
  });
});

describe("honest dose talk continues", () => {
  it.each([
    "I took my Concerta this morning.",
    "I take two a day with meals.",
    "I took one this morning and one tonight.",
    "Can I get an extra refill for my trip?",
    "Do I need an extra one for travel?",
    "I missed a dose yesterday.",
    "I took the last one yesterday.",
    "I'd like to double check my address.",
  ])("%j continues", (line) => {
    expect(action(line)).toBe("continue");
  });
});
