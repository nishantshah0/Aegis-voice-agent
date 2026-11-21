import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUTTON_NAMES, type ButtonResult, type PressFn } from "@/lib/contract";
import { createMemoryStore } from "@/lib/store/memory";
import { createSignedPress, type SignerRun } from "./signed-press";

const okResult = { ok: true, output: {}, ruleIds: [] } as ButtonResult;
const refusedResult = { ok: false, error: "refused", ruleIds: [] } as ButtonResult;

function fakeRun(decision: "allow" | "deny" | "ask" = "allow", events: string[] = []): SignerRun {
  return {
    runId: "run-synthetic",
    decide: vi.fn(async () => {
      events.push("decide");
      return { decision, decision_id: "decision-synthetic", rule_ids: ["policy-rule"] };
    }),
    complete: vi.fn(async () => {
      events.push("complete");
      return { event_id: "event-synthetic" };
    }),
  };
}

describe("createSignedPress", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let run: SignerRun;
  let press: ReturnType<typeof vi.fn>;
  let wrapped: PressFn;

  beforeEach(() => {
    store = createMemoryStore();
    run = fakeRun();
    press = vi.fn(async (_callId, _button, _input, auth) => auth?.tracekit?.outcome === "allow" ? okResult : refusedResult);
    wrapped = createSignedPress({
      press: press as unknown as PressFn,
      getRun: vi.fn(async () => run),
      store,
    });
  });

  it("decides every supported button before execution and signs only a result commitment", async () => {
    const events: string[] = [];
    run = fakeRun("allow", events);
    press = vi.fn(async (_callId, _button, _input, auth) => {
      events.push("press");
      return auth?.tracekit?.outcome === "allow" ? okResult : refusedResult;
    });
    wrapped = createSignedPress({ press: press as unknown as PressFn, getRun: vi.fn(async () => run), store });

    for (const button of BUTTON_NAMES) {
      const result = await wrapped("call-synthetic", button, { synthetic: true }, { invocationId: `tool-${button}` });
      expect(result.ok).toBe(true);
    }

    expect(run.decide).toHaveBeenCalledTimes(BUTTON_NAMES.length);
    expect(press).toHaveBeenCalledTimes(BUTTON_NAMES.length);
    expect(run.complete).toHaveBeenCalledTimes(BUTTON_NAMES.length);
    expect(events).toEqual(BUTTON_NAMES.flatMap(() => ["decide", "press", "complete"]));
    for (const [id, _status, fields] of vi.mocked(run.complete).mock.calls) {
      expect(id).toMatch(/^tool-/);
      expect(fields).toHaveProperty("result_digest");
      expect(fields).not.toHaveProperty("result");
    }
  });

  it.each(["deny", "ask"] as const)("does not execute when signer returns %s", async (decision) => {
    run = fakeRun(decision);
    wrapped = createSignedPress({ press: press as unknown as PressFn, getRun: async () => run, store });

    await expect(wrapped("call-synthetic", "request_refill", { rx_id: "rx_synthetic" }, { invocationId: "tool-denied" })).resolves.toMatchObject({ ok: false });

    expect(press).toHaveBeenCalledTimes(1);
    expect(press.mock.calls[0][3]).toMatchObject({ tracekit: { outcome: "deny", decisionId: "decision-synthetic" } });
  });

  it("fails closed and records a local blocked press if the signer cannot be reached", async () => {
    wrapped = createSignedPress({
      press: press as unknown as PressFn,
      getRun: async () => { throw new Error("signer unavailable"); },
      store,
    });

    await expect(wrapped("call-synthetic", "order_status", {}, { invocationId: "tool-offline" })).resolves.toMatchObject({ ok: false });
    expect(press).toHaveBeenCalledTimes(1);
    expect(press.mock.calls[0][3]).toMatchObject({ tracekit: { outcome: "unavailable" } });
    expect(run.decide).not.toHaveBeenCalled();
  });

  it("does not return a successful tool result when Tracekit reports that completion was not recorded", async () => {
    run.complete = vi.fn(async () => null);
    wrapped = createSignedPress({ press: press as unknown as PressFn, getRun: async () => run, store });

    await expect(wrapped("call-synthetic", "order_status", {}, { invocationId: "tool-result-gap" })).resolves.toMatchObject({ ok: false, error: "refused" });
    expect((await store.listRecord()).some((entry) => (entry.input as { check?: string })?.check === "tracekit_result_unrecorded")).toBe(true);
  });
});
