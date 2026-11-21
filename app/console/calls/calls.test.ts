import { beforeEach, describe, expect, it } from "vitest";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { resetBusForTests } from "@/lib/events/bus";
import { IDS } from "@/lib/seed";
import { getControl, getStore, resetRuntimeForTests } from "@/app/api/_lib/runtime";
import { laneTotals } from "../today/detail";
import { callsOverview, parseUsage } from "./calls";

beforeEach(async () => {
  resetBusForTests();
  await resetRuntimeForTests();
});

// Sam's outbound call on the real lock, as a driver would play it, with one blocked promise.
async function samsCall() {
  const store = getStore();
  const control = getControl();
  const guard = createSpeechGuard({ store, emit });
  const safety = createSafetyCheck({ store, emit });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await guard(callId, "Hi, this is Maple Street Pharmacy calling for Sam.");
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await safety(callId, "The code is here.");
  await control.press(callId, "check_code", { lookup_id: lookupId, code: (await control.codeFor(callId))!, dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await guard(callId, "Your Concerta refill is approved.");
  return callId;
}

describe("callsOverview (2.9b)", () => {
  it("shows a call's presses with outcomes and rules, its blocked lines, transcript and a verified record", async () => {
    const callId = await samsCall();
    const later = await getControl().startInboundCall();
    const overview = await callsOverview(getStore());

    expect(overview.calls.map((c) => c.callId)).toEqual([later, callId]);
    const call = overview.calls.find((c) => c.callId === callId)!;
    expect(call).toMatchObject({ direction: "outbound", patient: "S.R." });
    expect(call.presses.map((p) => [p.button, p.outcome])).toEqual([
      ["send_code", "allowed"],
      ["check_code", "allowed"],
      ["request_refill", "routed"],
    ]);
    expect(call.presses[2]).toMatchObject({ ruleIds: ["4"], lane: "quick_check" });
    expect(call.blocked).toEqual([expect.objectContaining({ rule: "S4", original: "Your Concerta refill is approved." })]);
    expect(call.transcript.map((l) => l.who)).toEqual(["agent", "caller", "agent"]);
    expect(call.record).toEqual({ entries: (await getStore().listRecord(callId)).length });
    expect(overview.chain.verified).toBe(true);
    expect(overview.chain.entries).toBe((await getStore().listRecord()).length);
    expect(overview.lanes).toEqual(await laneTotals(getStore()));
  });

  it("adds server-side turn timing from the driver when it has any", async () => {
    const callId = await samsCall();
    const driver = {
      turnTimings: (id: string) =>
        id === callId
          ? [
              { receivedAt: 0, firstModelTextMs: 400, firstGuardedMs: 700 },
              { receivedAt: 0, firstModelTextMs: 800, firstGuardedMs: 1100 },
            ]
          : [],
    };
    const call = (await callsOverview(getStore(), { driver })).calls.find((c) => c.callId === callId)!;
    expect(call.timing).toEqual({ turns: 2, medianFirstModelTextMs: 600, medianFirstGuardedMs: 900 });
  });
});

describe("parseUsage (2.9b)", () => {
  it("totals tokens, model calls and cost by model from results/agent-usage.jsonl lines, skipping bad lines", () => {
    const lines = [
      JSON.stringify({ at: "2026-11-21T16:47:02.334Z", callId: "c_0001", model: "claude-haiku-5-5", modelCalls: 2, costUsd: 0.01, usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 } }),
      "not json",
      JSON.stringify({ at: "2026-11-21T16:48:00.000Z", callId: "c_0001", model: "claude-haiku-5-5", modelCalls: 1, costUsd: 0.002, usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } }),
    ].join("\n");
    const usage = parseUsage(lines);
    expect(usage.entries).toBe(2);
    expect(usage.byModel["claude-haiku-5-5"]).toEqual({ turns: 2, modelCalls: 3, inputTokens: 15, outputTokens: 250, cacheReadTokens: 4000, cacheWriteTokens: 4000, costUsd: 0.012 });
    expect(usage.recent[0]).toMatchObject({ at: "2026-11-21T16:48:00.000Z", callId: "c_0001", costUsd: 0.002 });
  });

  it("is empty when there's no log yet", () => {
    expect(parseUsage("")).toEqual({ entries: 0, byModel: {}, recent: [] });
  });
});
