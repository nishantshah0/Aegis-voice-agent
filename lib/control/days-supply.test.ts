// Trail #85: days supply. Nishant's ask: "is able to allow refills for 7 days instead of like
// 14 if u want". A shorter supply than prescribed is a partial fill; never longer (rule 12).
// The quantity is worked out in code from the label, and no supply changes rules 3, 4 or 4b.
import { describe, expect, it } from "vitest";
import { STARTING_CARDS, type RuleCard, type Seed } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { applyApprovedCard } from "./cards";
import { evaluate } from "./engine";
import { quantityFor, unitsPerDay } from "./supply";
import { freshLock, verifiedCall } from "./testing/verify";

const pharmacist = { id: "u_ph", name: "Test Pharmacist", role: "pharmacist" as const };
const rx = (id: string) => SEED.prescriptions.find((r) => r.id === id)!;

describe("quantity from the label", () => {
  it("units a day from the directions, checked against the label's own Qty", () => {
    expect(unitsPerDay(rx(IDS.samConcerta).labelText)).toBe(1);
    expect(unitsPerDay(rx(IDS.samMetformin).labelText)).toBe(2);
    expect(unitsPerDay(rx(IDS.p2Atorvastatin).labelText)).toBe(1);
    expect(unitsPerDay(rx(IDS.p9Metoprolol).labelText)).toBe(2);
    expect(unitsPerDay(rx(IDS.p9Clonazepam).labelText)).toBe(1);
    expect(quantityFor(rx(IDS.samMetformin), 7)).toBe(14);
    expect(quantityFor(rx(IDS.samConcerta), 14)).toBe(14);
    for (const r of SEED.prescriptions) expect(quantityFor(r, r.daysSupplied), r.id).toBe(Number(r.labelText.match(/Qty (\d+)/)![1]));
  });

  it("gives no quantity when the directions aren't plain", () => {
    const base = rx(IDS.p6Amlodipine);
    for (const labelText of [
      "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth as needed. Qty 30.",
      "AMLODIPINE 5 MG TABLET. Take half a tablet by mouth once a day. Qty 15.",
      "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth every 8 hours. Qty 90.",
      "AMLODIPINE 5 MG TABLET. Take 1 tablet once a day and 1 tablet twice a day. Qty 30.",
      "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth once a day. Qty 60.",
      "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth once a day.",
    ]) {
      expect(quantityFor({ ...base, labelText }, 7), labelText).toBeUndefined();
    }
  });
});

describe("request_refill with days_supply", () => {
  it("a 7-day partial fill of a 30-day prescription: 7 tablets, queued, the pharmacist sees it", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "tom");
    const r = await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 7 });
    expect(r).toMatchObject({ ok: true, lane: "automatic", output: { state: "queued", days_supply: 7, quantity: 7 } });
    const order = (await store.listOrders(IDS.p6)).at(-1)!;
    expect(order).toMatchObject({ rxId: IDS.p6Amlodipine, daysSupply: 7, quantity: 7 });
    expect((await store.queue()).at(-1)).toMatchObject({ orderId: order.id, partialFill: { daysSupply: 7, quantity: 7 } });
    expect((await store.listRecord(callId)).at(-1)?.context).toMatchObject({ "request.days_supply": 7, "rx.days_supplied": 30, "rx.days_until_due": 3 });
  });

  it("twice a day for 7 days is 14 tablets", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "sam");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.samMetformin, days_supply: 7 })).toMatchObject({ ok: true, output: { days_supply: 7, quantity: 14 } });
  });

  it("the full prescribed supply is the label's Qty, not a partial fill", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "tom");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 30 })).toMatchObject({ ok: true, output: { state: "queued", days_supply: 30, quantity: 30 } });
    expect((await store.queue()).at(-1)?.partialFill).toBeUndefined();
  });

  it("no days_supply: as before, no supply fields", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "tom");
    const r = await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine });
    expect(r.ok && r.output).not.toHaveProperty("quantity");
    expect((await store.listOrders(IDS.p6)).at(-1)).not.toHaveProperty("daysSupply");
  });

  it("rule 12: never longer than prescribed", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "tom");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 31 })).toMatchObject({ ok: true, output: { state: "refused", rule_ids: ["12"] } });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 90 })).toMatchObject({ output: { state: "refused", rule_ids: ["12"] } });
    expect((await store.listOrders(IDS.p6)).length).toBe(0);
    expect((await store.listRecord(callId)).at(-1)).toMatchObject({ decision: "blocked", ruleIds: ["12"] });
  });

  it("card 12 refuses a longer supply on its own too", () => {
    const ctx = { "request.days_supply": 31, "rx.days_supplied": 30 };
    expect(evaluate(STARTING_CARDS.filter((c) => c.id === "12"), "request_refill", ctx)).toMatchObject({ outcome: "refuse", deciding: ["12"] });
    expect(evaluate(STARTING_CARDS.filter((c) => c.id === "12"), "request_refill", { ...ctx, "request.days_supply": 30 }).outcome).toBe("allowed");
  });

  it("refuses a days supply that isn't a whole number from 1", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "tom");
    for (const days_supply of [0, -7, 7.5, "7", null, 1e9, Number.NaN]) {
      expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply }), String(days_supply)).toMatchObject({ ok: false, error: "invalid_input" });
    }
  });

  it("a partial fill whose quantity the label can't give plainly is refused (rule 12)", async () => {
    const unclear: Seed = {
      ...SEED,
      prescriptions: SEED.prescriptions.map((r) => (r.id === IDS.p6Amlodipine ? { ...r, labelText: "AMLODIPINE 5 MG TABLET. Take 1 tablet by mouth as needed. Qty 30." } : r)),
    };
    const { control } = freshLock(unclear);
    const callId = await verifiedCall(control, "tom");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 7 })).toMatchObject({ output: { state: "refused", rule_ids: ["12"] } });
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p6Amlodipine })).toMatchObject({ output: { state: "queued" } });
  });

  it("controlled drugs: a shorter supply is never a way round rules 4 and 4b", async () => {
    const { control } = freshLock();
    const sam = await verifiedCall(control, "sam");
    expect(await control.press(sam, "request_refill", { rx_id: IDS.samConcerta, days_supply: 14 })).toMatchObject({
      ok: true,
      lane: "quick_check",
      output: { state: "waiting_for_pharmacist", rule_ids: ["4"], days_supply: 14, quantity: 14 },
    });
    const dev = await verifiedCall(control, "dev");
    for (const days_supply of [1, 3, 7, 14]) {
      expect(await control.press(dev, "request_refill", { rx_id: IDS.p4Adderall, days_supply }), String(days_supply)).toMatchObject({ output: { state: "refused", rule_ids: ["4b"] } });
    }
  });

  it("an early non-controlled partial fill still goes to the pharmacist (card 3)", async () => {
    const { control } = freshLock();
    const callId = await verifiedCall(control, "jordan");
    expect(await control.press(callId, "request_refill", { rx_id: IDS.p2Atorvastatin, days_supply: 7 })).toMatchObject({ lane: "review", output: { state: "waiting_for_pharmacist", rule_ids: ["3"] } });
  });

  it("an approver can add a stricter supply rule through the rule writer's approval, never a looser one", async () => {
    const { control, store } = freshLock();
    const card = (id: string, when: RuleCard["when"], then: RuleCard["then"]): RuleCard => ({
      id, wording: `card ${id}`, when, then, appliesTo: ["request_refill"], risk: "test", author: "rule writer", approvedBy: "", approvedAt: "", tests: [], live: false,
    });
    expect(await applyApprovedCard(store, card("w-short", [{ field: "request.days_supply", op: "<", value: 7 }], "route"), pharmacist)).toMatchObject({ ok: true });
    const tom = await verifiedCall(control, "tom");
    expect(await control.press(tom, "request_refill", { rx_id: IDS.p6Amlodipine, days_supply: 5 })).toMatchObject({ output: { state: "waiting_for_pharmacist", rule_ids: ["w-short"], quantity: 5 } });
    // A card meant to widen the controlled window (minus 10) can't: there is no allow, and 4b still refuses.
    expect(await applyApprovedCard(store, card("w-wide", [{ field: "drug.controlled", op: "=", value: true }, { field: "rx.days_since_last_fill", op: "<", value: { field: "rx.prescribed_interval_days", minus: 10 } }], "refuse"), pharmacist)).toMatchObject({ ok: true });
    const dev = await verifiedCall(control, "dev");
    expect(await control.press(dev, "request_refill", { rx_id: IDS.p4Adderall, days_supply: 7 })).toMatchObject({ output: { state: "refused", rule_ids: ["4b"] } });
  });

  it("the early-refill window is the policy setting card 4b reads (SPEC default 3)", () => {
    expect(SEED.policy.controlledEarlyWindowDays).toBe(3);
    expect(STARTING_CARDS.find((c) => c.id === "4b")?.when[1]).toMatchObject({ value: { minus: "policy.controlled_early_window_days" } });
  });
});
