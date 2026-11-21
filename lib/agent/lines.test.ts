import { describe, expect, it } from "vitest";

import { FAKE_SEED, SAM_CONCERTA } from "@/lib/contract/fakes";

import {
  ASK_TO_VERIFY,
  CODE_SENT,
  HOLDING,
  MISSED_DOSES_CHECK_IN,
  REFILL_SYNC_OFFER,
  SIDE_EFFECT_PASSED_ON,
  inboundGreeting,
  labelSideEffects,
  outboundOpener,
  outboundWrongPerson,
  sideEffectQuestion,
} from "./lines";

const samConcerta = FAKE_SEED.prescriptions.find((rx) => rx.id === SAM_CONCERTA)!;

/** A dose, frequency or quantity. S3 blocks any of these that the label does not carry. */
const DOSE = /\b\d+\s*(mg|mcg|ml|tablets?|capsules?)\b|\b(twice|once|three times)\s+a\s+day\b|\bevery\s+\d+\s*hours?\b/i;

describe("the scripted lines match SPEC Part 2", () => {
  it("greets an inbound caller with the pharmacy's name", () => {
    expect(inboundGreeting("Harbour Pharmacy")).toBe(
      "Hi, this is the automated assistant for Harbour Pharmacy. What can I help with?",
    );
  });

  it("asks for all three verification details", () => {
    for (const detail of ["name", "date of birth", "prescription number"]) {
      expect(ASK_TO_VERIFY).toContain(detail);
    }
  });

  it("says the code line the same way whether or not the details matched", () => {
    // A constant, not a template: there is no argument that could make the
    // wording differ for a patient who exists (SPEC Part 2, inbound step 3).
    expect(CODE_SENT).toBe("If those details match, I've sent a code to the phone on file.");
    expect(CODE_SENT).not.toMatch(/\$\{|%s/);
  });

  it("has a holding line", () => {
    expect(HOLDING).toBe("One moment.");
  });

  it("offers refill sync without naming the drug", () => {
    expect(REFILL_SYNC_OFFER).toBe("You have one other prescription ready to refill. Want me to add it?");
    expect(REFILL_SYNC_OFFER.toLowerCase()).not.toContain(samConcerta.drug.toLowerCase());
  });

  it("promises no callback time when rule 6 flagged missed doses", () => {
    expect(MISSED_DOSES_CHECK_IN).toContain("may call");
    expect(MISSED_DOSES_CHECK_IN).not.toMatch(/\b(will call|today|tomorrow|within)\b/i);
  });

  it("gives no advice when passing a side effect on", () => {
    expect(SIDE_EFFECT_PASSED_ON).toBe("Thanks, I've passed that to the pharmacist with your refill.");
    expect(SIDE_EFFECT_PASSED_ON).not.toMatch(/\b(should|try|stop|take|recommend)\b/i);
  });

  it("carries no dose, frequency or quantity in any fixed line", () => {
    const fixed = [
      inboundGreeting("Harbour Pharmacy"),
      ASK_TO_VERIFY,
      CODE_SENT,
      HOLDING,
      outboundOpener("Harbour Pharmacy", "Sam Rivera"),
      outboundWrongPerson("Harbour Pharmacy", "Sam Rivera"),
      REFILL_SYNC_OFFER,
      SIDE_EFFECT_PASSED_ON,
      MISSED_DOSES_CHECK_IN,
    ];
    for (const line of fixed) expect(line).not.toMatch(DOSE);
  });
});

describe("the outbound opener, the one exception to S1", () => {
  const opener = outboundOpener("Harbour Pharmacy", "Sam Rivera");

  it("says who is calling and who for", () => {
    expect(opener).toBe("This is Harbour Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.");
  });

  it("says nothing else about the patient or the prescription", () => {
    // S1 lets this line carry the patient's name and the pharmacy's name, and
    // nothing else. Everything the record holds about Sam must be absent.
    const sam = FAKE_SEED.patients.find((p) => p.id === samConcerta.patientId)!;
    const mustNotLeak = [
      sam.dob,
      sam.phone,
      samConcerta.rxNumber,
      samConcerta.drug,
      samConcerta.strength,
      samConcerta.patientPays,
      ...sam.addresses.map((a) => a.line1),
    ];
    for (const secret of mustNotLeak) {
      expect(opener.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(opener).not.toMatch(/\brefill|runs out|medication|prescription\b/i);
  });

  it("tells a household member nothing when the wrong person answers", () => {
    const line = outboundWrongPerson("Harbour Pharmacy", "Sam Rivera");
    expect(line).toContain("Sam Rivera");
    expect(line).not.toMatch(/\brefill|medication|prescription|runs out\b/i);
  });
});

describe("the side-effect question is built from label text", () => {
  it("quotes the side effects a label lists", () => {
    const label = "CONCERTA 36 MG TABLET. Take 1 tablet by mouth every morning. Side effects may include: trouble sleeping, less appetite, headaches or stomach aches. Qty 30.";
    expect(labelSideEffects(label)).toBe("trouble sleeping, less appetite, headaches or stomach aches");
    expect(sideEffectQuestion(label)).toBe(
      "Since your last refill, any side effects, like trouble sleeping, less appetite, headaches or stomach aches, or anything else?",
    );
  });

  it("reads a 'may cause' label too", () => {
    expect(labelSideEffects("LISINOPRIL 10 MG TABLET. May cause dizziness or a dry cough. Qty 30.")).toBe(
      "dizziness or a dry cough",
    );
  });

  it("invents nothing when the label lists no side effects", () => {
    // Every seeded label holds directions only, so this is the live behaviour
    // today. The question still gets asked; it just names nothing.
    expect(labelSideEffects(samConcerta.labelText)).toBeNull();
    expect(sideEffectQuestion(samConcerta.labelText)).toBe(
      "Since your last refill, have you noticed any side effects, or anything else?",
    );
  });

  it("names no side effect that the label does not carry", () => {
    for (const rx of FAKE_SEED.prescriptions) {
      const question = sideEffectQuestion(rx.labelText);
      const quoted = labelSideEffects(rx.labelText);
      if (quoted === null) {
        // Nothing clinical may appear from the model's own knowledge.
        expect(question).toBe("Since your last refill, have you noticed any side effects, or anything else?");
      } else {
        expect(rx.labelText).toContain(quoted);
      }
    }
  });

  it("always asks the one structured question", () => {
    for (const rx of FAKE_SEED.prescriptions) {
      expect(sideEffectQuestion(rx.labelText)).toMatch(/^Since your last refill, /);
      expect(sideEffectQuestion(rx.labelText)).toMatch(/or anything else\?$/);
    }
  });
});
