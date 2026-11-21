import { describe, expect, it } from "vitest";

import { FAKE_SEED, SAM_ID } from "@/lib/contract/fakes";

import { systemPrompt } from "./prompt";

const inbound = systemPrompt({ pharmacyName: "Harbour Pharmacy", direction: "inbound" });
const outbound = systemPrompt({ pharmacyName: "Harbour Pharmacy", direction: "outbound" });

describe("the prompt says the three firm things", () => {
  it.each([
    ["quote the label", /label/i],
    ["never advise", /medical advice/i],
    ["hand over whenever asked", /asks for a person/i],
  ])("says %s", (_what, pattern) => {
    expect(inbound).toMatch(pattern);
    expect(outbound).toMatch(pattern);
  });

  it("hands over without needing a reason", () => {
    expect(inbound).toMatch(/never need a reason/i);
  });
});

describe("the prompt has no list of forbidden things", () => {
  // SPEC Part 2, "The prompt": the control layer enforces what cannot happen, so
  // the prompt does not enumerate it. These are the entries in the "Never" row of
  // the risk-tier table, which is exactly what must not be restated here.
  it.each([
    ["changing a drug, dose or quantity", /chang(e|ing)[^.]*\b(drug|dose|dosage|quantity|strength)\b/i],
    ["adding a prescription", /add(ing)?\s+a\s+(new\s+)?prescription/i],
    ["another person's prescriptions", /(another|someone else's|other)\s+(person|patient|people)/i],
    ["controlled drugs", /controlled/i],
    ["early refills", /\bearly\b/i],
  ])("does not mention %s", (_what, pattern) => {
    expect(inbound).not.toMatch(pattern);
    expect(outbound).not.toMatch(pattern);
  });

  it("does not name any rule or button-level prohibition", () => {
    expect(inbound).not.toMatch(/\brule\s*\d|\bS[1-4]\b|\bforbidden\b|\bnot allowed\b|\byou may not\b/i);
    expect(outbound).not.toMatch(/\brule\s*\d|\bS[1-4]\b|\bforbidden\b|\bnot allowed\b|\byou may not\b/i);
  });
});

describe("the prompt is per call and carries no patient data", () => {
  it("names the pharmacy it was built for", () => {
    expect(inbound).toContain("Harbour Pharmacy");
    expect(systemPrompt({ pharmacyName: "Riverside Chemist", direction: "inbound" })).toContain("Riverside Chemist");
    expect(inbound).not.toMatch(/\[pharmacy name\]/i);
  });

  it("holds nothing from the patient records", () => {
    const sam = FAKE_SEED.patients.find((p) => p.id === SAM_ID)!;
    const rxs = FAKE_SEED.prescriptions.filter((rx) => rx.patientId === SAM_ID);
    const mustNotLeak = [
      sam.firstName,
      sam.lastName,
      sam.dob,
      sam.phone,
      ...rxs.map((rx) => rx.drug),
      ...rxs.map((rx) => rx.rxNumber),
      ...rxs.map((rx) => rx.strength),
    ];
    for (const secret of mustNotLeak) {
      for (const prompt of [inbound, outbound]) {
        expect(prompt.toLowerCase()).not.toContain(secret.toLowerCase());
      }
    }
  });

  it("tells the inbound call to answer general questions before verifying", () => {
    expect(inbound).toMatch(/general pharmacy questions/i);
    expect(inbound).toMatch(/name, date of birth and prescription number/i);
  });

  it("tells the outbound call to keep the reason back until the code is read", () => {
    expect(outbound).toMatch(/not the drug, not the reason/i);
    expect(outbound).toMatch(/read the code back/i);
  });

  it("differs by direction", () => {
    expect(inbound).not.toBe(outbound);
  });
});

describe("the prompt sets the tone SPEC Part 2 asks for", () => {
  it.each([
    ["friendly, plain and patient", /friendly, plain and patient/i],
    ["small talk", /small talk/i],
    ["repeating itself", /repeat yourself/i],
    ["a caller who wanders", /wanders/i],
  ])("allows %s", (_what, pattern) => {
    expect(inbound).toMatch(pattern);
  });

  it("asks for plain spoken sentences, since every word is read aloud on a call", () => {
    // Live run results/agent-live/sam-2026-11-21T16-49-38-431Z.json: Haiku said "- **Drug:** Concerta".
    const prompt = systemPrompt({ pharmacyName: "Maple Street Pharmacy", direction: "outbound" });
    expect(prompt).toMatch(/plain spoken sentences/i);
    expect(prompt).toMatch(/no lists, headings or formatting/i);
  });

  it("saves completion words for after the button says so", () => {
    // Channel note to Role 1 after the Trail #27 S4 round: a live "Done." before
    // an approval is replaced by the guard and sends the refill to Review. The
    // prompt gives the conditional form instead, so the honest line is the
    // natural one to say.
    expect(inbound).toMatch(/already happened/i);
    expect(inbound).toMatch(/once a button has come back saying so/i);
    // The wording the guard actually allows. This assertion used to demand
    // "a pharmacist will approve it, then it's ready Thursday", which S4 blocks:
    // prompt.guard.test.ts now checks every quoted example against the real guard
    // so a blocked example can't be asserted into the prompt again.
    expect(inbound).toMatch(/I'll confirm once it's approved/i);
    expect(inbound).toMatch(/I don't have a ready time yet/i);
  });

  it("makes the buttons the only way it acts", () => {
    expect(inbound).toMatch(/buttons are how you act/i);
    expect(inbound).toMatch(/one button at a time/i);
    expect(inbound).toMatch(/what it returns is what is true/i);
  });
});
