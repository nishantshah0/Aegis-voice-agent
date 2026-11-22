import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Approver } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import type { Proposal } from "@/lib/arena/rule-writer";
import { resetDraftsForTests, setProposerForTests } from "./_lib/rule-drafts";
import { getStore, resetRuntimeForTests } from "./_lib/runtime";
import { POST as draftRule } from "./rules/draft/route";
import { POST as approveRule } from "./rules/[id]/approve/route";

// AUDIT #9 (Trail #78): POST /api/rules/draft and /api/rules/:id/approve. A pharmacist
// writes a sentence and gets a DRAFT card; only a pharmacist's approval, through lock code,
// puts it live. The model is replaced here by a fixed proposer.

const session = vi.hoisted(() => ({ approver: null as Approver | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getApprover: async () => session.approver,
}));

const PHARMACIST: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };
const REVIEWER: Approver = { id: "auth0|test-reviewer", name: "Test Reviewer", role: "reviewer" };

const antibiotic: Proposal = {
  card: { wording: "Any antibiotic refill needs a pharmacist.", when: [{ field: "drug.class", op: "=", value: "antibiotic" }], then: "route", appliesTo: ["request_refill"], risk: "Antibiotic stewardship" },
  restatement: "Every refill of a drug in the antibiotic class will wait for a pharmacist.",
  tests: [
    { kind: "should_catch", description: "amoxicillin", button: "request_refill", context: { "drug.class": "antibiotic" }, expectMatch: true },
    { kind: "should_not_catch", description: "statin", button: "request_refill", context: { "drug.class": "statin" }, expectMatch: false },
    { kind: "edge", description: "renewal", button: "request_renewal", context: { "drug.class": "antibiotic" }, expectMatch: false },
  ],
};

const post = (body: unknown) => new Request("http://test.local/api/rules/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const approve = (id: string) => approveRule(new Request(`http://test.local/api/rules/${id}/approve`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  session.approver = null;
  await resetRuntimeForTests();
  resetDraftsForTests();
  setProposerForTests(async () => structuredClone(antibiotic));
});

describe("POST /api/rules/draft", () => {
  it("is for signed-in pharmacists only", async () => {
    expect((await draftRule(post({ text: "Any antibiotic refill needs a pharmacist." }))).status).toBe(401);
    session.approver = REVIEWER;
    expect((await draftRule(post({ text: "Any antibiotic refill needs a pharmacist." }))).status).toBe(403);
  });

  it("needs a sentence", async () => {
    session.approver = PHARMACIST;
    expect((await draftRule(post({ text: "  " }))).status).toBe(400);
    expect((await draftRule(post({}))).status).toBe(400);
  });

  it("returns a draft that is not live, and changes no cards", async () => {
    session.approver = PHARMACIST;
    const res = await draftRule(post({ text: "Any antibiotic refill needs a pharmacist." }));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft).toMatchObject({ ready: true, card: { live: false, approvedBy: "" } });
    expect(draft.card.id).toMatch(/^w\d+$/);
    expect(await getStore().listCards()).toEqual(SEED.cards);
  });

  it("says so when the model isn't available, instead of inventing a card", async () => {
    session.approver = PHARMACIST;
    setProposerForTests(null);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await draftRule(post({ text: "Any antibiotic refill needs a pharmacist." }));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("POST /api/rules/:id/approve", () => {
  async function makeDraft() {
    session.approver = PHARMACIST;
    return (await (await draftRule(post({ text: "Any antibiotic refill needs a pharmacist." }))).json()).draft as { card: { id: string } };
  }

  it("is for signed-in pharmacists only, and a reviewer can't put a rule live", async () => {
    const draft = await makeDraft();
    session.approver = null;
    expect((await approve(draft.card.id)).status).toBe(401);
    session.approver = REVIEWER;
    expect((await approve(draft.card.id)).status).toBe(403);
    expect(await getStore().listCards()).toEqual(SEED.cards);
  });

  it("puts the card live with the pharmacist's name and time, once", async () => {
    const draft = await makeDraft();
    const res = await approve(draft.card.id);
    expect(res.status).toBe(200);
    const { card } = await res.json();
    expect(card).toMatchObject({ id: draft.card.id, live: true, approvedBy: "Test Pharmacist" });
    expect((await getStore().listCards()).at(-1)).toMatchObject({ id: draft.card.id, live: true });
    expect((await approve(draft.card.id)).status).toBe(409);
  });

  it("won't approve a draft whose tests fail", async () => {
    const failing = structuredClone(antibiotic);
    failing.tests[0].expectMatch = false;
    setProposerForTests(async () => failing);
    const draft = await makeDraft();
    expect((await approve(draft.card.id)).status).toBe(409);
    expect(await getStore().listCards()).toEqual(SEED.cards);
  });

  it("404s an unknown draft", async () => {
    session.approver = PHARMACIST;
    expect((await approve("w999")).status).toBe(404);
  });
});
