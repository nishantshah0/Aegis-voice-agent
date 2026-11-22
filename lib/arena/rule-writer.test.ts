import { describe, expect, it } from "vitest";
import type { Approver } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { writeDraft, type Proposal } from "./rule-writer";

// AUDIT #9 (Trail #78): the rule writer turns a sentence into a DRAFT card. The model only
// proposes; the card is checked by the lock's checkCard, its three tests run in code, and the
// impact is replayed over the stored context of every past refill request. Nothing goes live.

const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };

const antibiotic: Proposal = {
  card: { wording: "Any antibiotic refill needs a pharmacist.", when: [{ field: "drug.class", op: "=", value: "antibiotic" }], then: "route", appliesTo: ["request_refill"], risk: "Antibiotic stewardship" },
  restatement: "Every refill of a drug in the antibiotic class will wait for a pharmacist.",
  tests: [
    { kind: "should_catch", description: "An amoxicillin refill", button: "request_refill", context: { "drug.class": "antibiotic" }, expectMatch: true },
    { kind: "should_not_catch", description: "A statin refill", button: "request_refill", context: { "drug.class": "statin" }, expectMatch: false },
    { kind: "edge", description: "An antibiotic renewal isn't a refill", button: "request_renewal", context: { "drug.class": "antibiotic" }, expectMatch: false },
  ],
};

const propose = (p: Proposal) => async () => structuredClone(p);

describe("writeDraft", () => {
  it("returns a draft card, never live, with its tests run in code", async () => {
    const store = createMemoryStore(SEED);
    const draft = await writeDraft({ id: "w1", text: "Any antibiotic refill needs a pharmacist.", author: pharmacist, store, propose: propose(antibiotic) });
    expect(draft.card).toMatchObject({ id: "w1", live: false, approvedBy: "", approvedAt: "", then: "route" });
    expect(draft.card.author).toContain("Test Pharmacist");
    expect(draft.restatement).toBe(antibiotic.restatement);
    expect(draft.tests.map((t) => [t.kind, t.matched, t.passed])).toEqual([
      ["should_catch", true, true],
      ["should_not_catch", false, true],
      ["edge", false, true],
    ]);
    expect(draft.problems).toEqual([]);
    expect(draft.ready).toBe(true);
    expect(await store.listCards()).toEqual(SEED.cards);
  });

  it("replays the card over every stored refill request's context", async () => {
    const store = createMemoryStore(SEED);
    const ctx = (drugClass: string) => ({ "drug.class": drugClass, "drug.controlled": false, "rx.pct_days_elapsed": 90 });
    await store.appendRecord({ actor: "agent", kind: "button", button: "request_refill", context: ctx("antibiotic"), decision: "allowed" });
    await store.appendRecord({ actor: "agent", kind: "button", button: "request_refill", context: ctx("statin"), decision: "allowed" });
    await store.appendRecord({ actor: "agent", kind: "button", button: "request_renewal", context: ctx("antibiotic"), decision: "allowed" });
    const draft = await writeDraft({ id: "w1", text: "x", author: pharmacist, store, propose: propose(antibiotic) });
    expect(draft.impact).toEqual({ button: "request_refill", total: 2, matched: 1, outcome: "route" });
  });

  it("isn't ready when a test fails, and says which", async () => {
    const wrong = structuredClone(antibiotic);
    wrong.tests[1].expectMatch = true;
    const draft = await writeDraft({ id: "w1", text: "x", author: pharmacist, store: createMemoryStore(SEED), propose: propose(wrong) });
    expect(draft.tests[1].passed).toBe(false);
    expect(draft.ready).toBe(false);
    expect(draft.problems.join(" ")).toMatch(/shouldn't catch|should_not_catch|test/i);
  });

  it("isn't ready when the proposed card fails the lock's check", async () => {
    const loose = structuredClone(antibiotic);
    (loose.card as { then: string }).then = "allow";
    const draft = await writeDraft({ id: "w1", text: "x", author: pharmacist, store: createMemoryStore(SEED), propose: propose(loose) });
    expect(draft.ready).toBe(false);
    expect(draft.problems.length).toBeGreaterThan(0);
  });

  it("isn't ready with fewer than three tests", async () => {
    const few = structuredClone(antibiotic);
    few.tests = few.tests.slice(0, 2);
    const draft = await writeDraft({ id: "w1", text: "x", author: pharmacist, store: createMemoryStore(SEED), propose: propose(few) });
    expect(draft.ready).toBe(false);
  });
});
