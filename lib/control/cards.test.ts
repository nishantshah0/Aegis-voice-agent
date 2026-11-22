import { describe, expect, it } from "vitest";
import type { Approver, RuleCard } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { applyApprovedCard, checkCard } from "./cards";
import { evaluate } from "./engine";

// AUDIT #9 (Trail #78): a written rule card can only refuse, route or flag, reads only the
// listed fields, never touches the core rules, and goes live only through this lock code,
// with a signed-in pharmacist's name and the time on it.

const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const reviewer: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };

const draft = (over: Partial<RuleCard> = {}): RuleCard => ({
  id: "w1",
  wording: "Any antibiotic refill needs a pharmacist.",
  when: [{ field: "drug.class", op: "=", value: "antibiotic" }],
  then: "route",
  appliesTo: ["request_refill"],
  risk: "Antibiotic stewardship",
  author: "rule writer (Fable 5.2) for Test Pharmacist",
  approvedBy: "",
  approvedAt: "",
  tests: ["should catch", "shouldn't catch", "edge"],
  live: false,
  ...over,
});

describe("checkCard", () => {
  it("accepts a well-formed card", () => {
    expect(checkCard(draft(), SEED.cards)).toEqual({ ok: true, card: draft() });
  });

  it("refuses any outcome other than refuse, route or flag", () => {
    const res = checkCard({ ...draft(), then: "allow" }, SEED.cards);
    expect(res.ok).toBe(false);
  });

  it("refuses a field that isn't on the list, and a bad operator", () => {
    expect(checkCard(draft({ when: [{ field: "patient.name" as never, op: "=", value: "x" }] }), SEED.cards).ok).toBe(false);
    expect(checkCard(draft({ when: [{ field: "drug.class", op: "~=" as never, value: "x" }] }), SEED.cards).ok).toBe(false);
    expect(checkCard(draft({ when: [{ field: "rx.refills_left", op: "<", value: "three" }] }), SEED.cards).ok).toBe(false);
    expect(checkCard(draft({ when: [{ field: "drug.class", op: "in", value: "antibiotic" }] }), SEED.cards).ok).toBe(false);
  });

  it("refuses a card with no conditions, which would match everything", () => {
    expect(checkCard(draft({ when: [] }), SEED.cards).ok).toBe(false);
  });

  it("refuses a core rule id, a speech rule id, or an id that's already a card", () => {
    for (const id of ["1", "5", "S4", "2a"]) expect(checkCard(draft({ id }), SEED.cards).ok).toBe(false);
  });

  it("only applies to buttons the rule cards are checked on", () => {
    expect(checkCard(draft({ appliesTo: ["verify_identity" as never] }), SEED.cards).ok).toBe(false);
    expect(checkCard(draft({ appliesTo: [] }), SEED.cards).ok).toBe(false);
  });

  it("refuses a draft that claims to be live or approved already", () => {
    expect(checkCard(draft({ live: true }), SEED.cards).ok).toBe(false);
    expect(checkCard(draft({ approvedBy: "someone" }), SEED.cards).ok).toBe(false);
  });
});

describe("applyApprovedCard", () => {
  it("puts a pharmacist's name and the time on the card, adds it live, and records the change", async () => {
    const store = createMemoryStore(SEED);
    const res = await applyApprovedCard(store, draft(), pharmacist);
    expect(res).toMatchObject({ ok: true, card: { id: "w1", live: true, approvedBy: "Test Pharmacist", approvedAt: SEED.now } });
    const cards = await store.listCards();
    expect(cards.at(-1)).toMatchObject({ id: "w1", live: true });
    const entry = (await store.listRecord()).at(-1)!;
    expect(entry).toMatchObject({ kind: "rule_change", actor: "pharmacist", decision: "allowed", ruleIds: ["w1"] });
    expect(entry.input).toMatchObject({ approver: { id: pharmacist.id, name: pharmacist.name } });
    // Live now: an antibiotic refill routes.
    const verdict = evaluate(cards, "request_refill", { "drug.class": "antibiotic", "drug.controlled": false, "rx.pct_days_elapsed": 95, "rx.days_late": 0, "rx.refills_left": 2, "rx.expired": false, "rx.days_since_last_fill": 28, "rx.prescribed_interval_days": 30, "recent.blocked_count_10min": 0, "policy.controlled_early_window_days": 3, "request.days_supply": 30, "rx.days_supplied": 30 });
    expect(verdict.deciding).toEqual(["w1"]);
  });

  it("refuses anyone who isn't a pharmacist, and changes nothing", async () => {
    const store = createMemoryStore(SEED);
    expect(await applyApprovedCard(store, draft(), reviewer)).toMatchObject({ ok: false });
    expect(await store.listCards()).toEqual(SEED.cards);
    expect(await store.listRecord()).toEqual([]);
  });

  it("re-checks the card itself, so a bad draft can't go live", async () => {
    const store = createMemoryStore(SEED);
    expect(await applyApprovedCard(store, { ...draft(), then: "allow" } as unknown as RuleCard, pharmacist)).toMatchObject({ ok: false });
    expect(await applyApprovedCard(store, draft({ id: "4b" }), pharmacist)).toMatchObject({ ok: false });
    expect(await store.listCards()).toEqual(SEED.cards);
  });
});
