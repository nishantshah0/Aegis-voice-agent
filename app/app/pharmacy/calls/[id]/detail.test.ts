import { beforeEach, describe, expect, it } from "vitest";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { callDetail, usageFor } from "./detail";

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

// Sam's outbound call on the real lock, with one blocked promise.
async function samsCall() {
  const store = getStore();
  const control = getControl();
  const guard = createSpeechGuard({ store, emit });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await guard(callId, "Hi, this is Maple Street Pharmacy calling for Sam.");
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await createSafetyCheck({ store, emit })(callId, "The code is here.");
  await control.press(callId, "check_code", { lookup_id: lookupId, code: (await control.codeFor(callId))!, dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await guard(callId, "Your Concerta refill is approved.");
  return callId;
}

describe("callDetail", () => {
  it("lays out the record in order, with presses, the blocked line and a verified chain", async () => {
    const callId = await samsCall();
    const detail = (await callDetail(getStore(), callId))!;
    expect(detail).toMatchObject({ callId, direction: "outbound", patient: "S.R.", verified: true, outcome: "waiting" });
    const seqs = detail.timeline.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(detail.timeline.filter((e) => e.group === "button").map((e) => [e.button, e.decision])).toEqual([
      ["send_code", "allowed"],
      ["check_code", "allowed"],
      ["request_refill", "routed"],
    ]);
    expect(detail.timeline.find((e) => e.group === "blocked")).toMatchObject({ rule: "S4", text: "Your Concerta refill is approved." });
    expect(detail.chain).toMatchObject({ verified: true, brokenAt: null, first: seqs[0], last: seqs.at(-1) });
    expect(detail.items).toEqual([expect.objectContaining({ kind: "refill", status: "open", drug: expect.stringContaining("Concerta") })]);
  });

  it("never shows the control layer's internal output (code hashes, matched patient)", async () => {
    const callId = await samsCall();
    const detail = (await callDetail(getStore(), callId))!;
    for (const e of detail.timeline) expect(e.output ?? "").not.toContain("internal");
  });

  it("shows the pharmacist's decision with their name and note", async () => {
    const callId = await samsCall();
    const [item] = await getStore().queue();
    await getStore().decide(item.id, "approve", { id: "u_test", name: "Test Pharmacist", role: "pharmacist" }, "chat at pickup");
    const detail = (await callDetail(getStore(), callId))!;
    expect(detail.outcome).toBe("approved");
    expect(detail.items[0]).toMatchObject({ status: "approved", decidedBy: "Test Pharmacist", decisionNote: "chat at pickup" });
    expect(detail.timeline.at(-1)).toMatchObject({ group: "decision", summary: 'Approved by Test Pharmacist: "chat at pickup"' });
  });

  it("returns null for a call that doesn't exist", async () => {
    expect(await callDetail(getStore(), "c_nope")).toBeNull();
  });
});

describe("usageFor", () => {
  it("keeps only rows logged under the call id, newest first", () => {
    const log = [
      JSON.stringify({ at: "2026-11-21T10:00:00Z", callId: "c_0001", model: "claude-haiku-5-5", modelCalls: 2, usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.001 }),
      JSON.stringify({ at: "2026-11-21T11:00:00Z", callId: "c_0002", model: "claude-haiku-5-5", usage: { input_tokens: 1 } }),
      "not json",
      JSON.stringify({ at: "2026-11-21T12:00:00Z", callId: "c_0001", model: "claude-haiku-5-5", usage: { input_tokens: 3, output_tokens: 1 } }),
    ].join("\n");
    const rows = usageFor(log, "c_0001");
    expect(rows.map((r) => r.at)).toEqual(["2026-11-21T12:00:00Z", "2026-11-21T10:00:00Z"]);
    expect(rows[1]).toMatchObject({ modelCalls: 2, inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
    expect(rows[0].modelCalls).toBe(1);
  });
});
