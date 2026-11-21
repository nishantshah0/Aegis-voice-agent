import { beforeEach, describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests, subscribe } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { itemDetail, laneTotals } from "./detail";

// Sam's outbound call on the real lock, as a driver would play it.
async function samsCall() {
  const store = getStore();
  const control = getControl();
  const guard = createSpeechGuard({ store, emit });
  const safety = createSafetyCheck({ store, emit });
  const events: StreamEvent[] = [];
  subscribe((d) => events.push(d.event));

  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await guard(callId, "Hi, this is Maple Street Pharmacy calling for Sam.");
  await control.press(callId, "send_code", { lookup_id: lookupId });
  const code = (await control.codeFor(callId))!;
  await safety(callId, `The code is ${code}.`);
  await control.press(callId, "check_code", { lookup_id: lookupId, code , dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta, reason: "Patient sounds confident about the dose" });
  await guard(callId, "Your Concerta refill is approved.");
  await safety(callId, "I've had some mild headaches in the afternoon.");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" });
  return callId;
}

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

describe("laneTotals", () => {
  it("counts items in each lane", async () => {
    await samsCall();
    const totals = await laneTotals(getStore());
    expect(totals.quick_check).toBe(1);
    expect(totals.review).toBeGreaterThanOrEqual(1);
    expect(totals.automatic).toBe(0);
  });
});

describe("itemDetail", () => {
  it("shows the rule that sent it, the side effect in Sam's words, what he was told, the transcript, signals and the AI's view", async () => {
    const callId = await samsCall();
    const [refill] = await getStore().queue("quick_check");
    const d = await itemDetail(getStore(), refill);

    expect(d.patient).toBe("S.R.");
    expect(d.drug).toBe("Concerta 36 mg");
    const card4 = (await getStore().listCards()).find((c) => c.id === "4")!;
    expect(d.rules).toContainEqual({ id: "4", wording: card4.wording });
    expect(d.sideEffects).toContain("Mild afternoon headaches");
    expect(d.told).toContainEqual({ text: "Hi, this is Maple Street Pharmacy calling for Sam.", blocked: false });
    expect(d.told).toContainEqual(expect.objectContaining({ text: "Your Concerta refill is approved.", blocked: true, rule: "S4" }));
    expect(d.transcript.map((l) => l.who)).toEqual(["agent", "caller", "agent", "caller"]);
    expect(d.transcript[3]).toMatchObject({ who: "caller", text: "I've had some mild headaches in the afternoon." });
    expect(d.aiView).toBe("Patient sounds confident about the dose");
    expect(d.callId).toBe(callId);
  });

  it("names the core rules by their SPEC wording", async () => {
    await samsCall();
    const [refill] = await getStore().queue("quick_check");
    const d = await itemDetail(getStore(), { ...refill, ruleIds: ["1", "5"] });
    expect(d.rules.map((r) => r.id)).toEqual(["1", "5"]);
    expect(d.rules.every((r) => r.wording.length > 0)).toBe(true);
  });
});
