// Trail #85: refill_history. Nishant's ask: "tell u back ur info like last time u got a refill
// ur amount all of that". The verified patient's own last fill, and the next day the live
// cards would let a refill through without it being early.
import { describe, expect, it } from "vitest";
import type { ButtonOutputs, RuleCard } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { applyApprovedCard } from "./cards";
import { freshLock, verifiedCall } from "./testing/verify";

type History = ButtonOutputs["refill_history"];
const pharmacist = { id: "u_ph", name: "Test Pharmacist", role: "pharmacist" as const };

async function history(who: Parameters<typeof verifiedCall>[1], rxId: string, setup?: (s: ReturnType<typeof freshLock>) => Promise<void>) {
  const lock = freshLock();
  if (setup) await setup(lock);
  const callId = await verifiedCall(lock.control, who);
  return lock.control.press(callId, "refill_history", { rx_id: rxId });
}

describe("refill_history", () => {
  it("rule 1: needs a verified call", async () => {
    const { control } = freshLock();
    const callId = await control.startInboundCall();
    expect(await control.press(callId, "refill_history", { rx_id: IDS.samConcerta })).toMatchObject({ ok: false, error: "not_verified", ruleIds: ["1"] });
  });

  it("rule 1: never another patient's prescription, or one that doesn't exist", async () => {
    expect(await history("sam", IDS.p4Adderall)).toMatchObject({ ok: false, error: "not_yours", ruleIds: ["1"] });
    expect(await history("sam", "rx_missing")).toMatchObject({ ok: false, error: "not_yours" });
    expect(await history("sam", IDS.samConcerta, undefined)).toMatchObject({ ok: true });
  });

  it("reads back Sam's last Concerta fill: a Wednesday 27 days ago, 30 tablets, 30 days, picked up, eligible today", async () => {
    const r = await history("sam", IDS.samConcerta);
    expect(r).toMatchObject({
      ok: true,
      output: {
        rx_id: IDS.samConcerta,
        drug: "Concerta",
        last_fill: SEED.prescriptions.find((x) => x.id === IDS.samConcerta)!.lastFill,
        last_fill_day: "Wednesday",
        last_fill_quantity: 30,
        last_fill_unit: "tablet",
        last_fill_days_supply: 30,
        last_fill_method: "pickup",
        refills_left: 2,
        days_supply_prescribed: 30,
        next_eligible: SEED.now,
        next_eligible_day: "Tuesday",
        prescriber: "Dr. Fairweather",
      } satisfies Partial<History>,
    });
  });

  it("works out the next eligible day from the live cards: card 3 for Jordan, card 4b for Dev", async () => {
    const jordan = await history("jordan", IDS.p2Atorvastatin);
    // Filled 10 days ago, 30 days: 80% is day 24, so 14 days from now.
    expect(jordan).toMatchObject({ ok: true, output: { next_eligible: "2026-12-08T15:00:00.000Z", next_eligible_day: "Tuesday", last_fill_method: "pickup" } });
    const dev = await history("dev", IDS.p4Adderall);
    // Controlled, filled 20 days ago, interval 30, window 3: day 27, 7 days from now.
    expect(dev).toMatchObject({ ok: true, output: { next_eligible: "2026-12-01T15:00:00.000Z", next_eligible_day: "Tuesday", last_fill_unit: "capsule" } });
    expect((await history("grace", IDS.p5Levothyroxine)) as { output?: History }).toMatchObject({ output: { next_eligible: SEED.now, last_fill_method: "delivery" } });
  });

  it("has no next eligible day for an expired prescription", async () => {
    expect(await history("maria", IDS.p3Lisinopril)).toMatchObject({ ok: true, output: { next_eligible: null, refills_left: expect.any(Number) } });
    const r = (await history("maria", IDS.p3Lisinopril)) as { output: History };
    expect(r.output.next_eligible_day).toBeUndefined();
  });

  it("an approver's tighter early window moves the eligible day (the window is a rule-card parameter)", async () => {
    const tighter: RuleCard = {
      id: "w-window",
      wording: "A controlled-drug refill no earlier than 2 days before the interval the prescriber wrote.",
      when: [
        { field: "drug.controlled", op: "=", value: true },
        { field: "rx.days_since_last_fill", op: "<", value: { field: "rx.prescribed_interval_days", minus: 2 } },
      ],
      then: "refuse",
      appliesTo: ["request_refill"],
      risk: "Early stimulant refills",
      author: "rule writer",
      approvedBy: "",
      approvedAt: "",
      tests: [],
      live: false,
    };
    const r = await history("sam", IDS.samConcerta, async ({ store }) => {
      expect(await applyApprovedCard(store, tighter, pharmacist)).toMatchObject({ ok: true });
    });
    expect(r).toMatchObject({ ok: true, output: { next_eligible: "2026-11-25T15:00:00.000Z", next_eligible_day: "Wednesday" } });
  });

  it("is written to the record as an allowed press for the locked patient", async () => {
    const { control, store } = freshLock();
    const callId = await verifiedCall(control, "sam");
    await control.press(callId, "refill_history", { rx_id: IDS.samMetformin });
    expect((await store.listRecord(callId)).at(-1)).toMatchObject({ button: "refill_history", decision: "allowed", output: { internal: { patientId: IDS.sam, rxId: IDS.samMetformin } } });
  });
});
