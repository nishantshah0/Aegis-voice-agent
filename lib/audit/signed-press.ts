import { argsDigest, Client, type Decision, type Frame, type RunHandle } from "@cygnuxlabs/tracekit/v2";
import { randomUUID } from "node:crypto";
import { BUTTON_NAMES, type ButtonName, type ButtonResult, type CallId, type PressContext, type PressFn, type Store } from "@/lib/contract";

export type SignerDecision = Decision;

export type SignerRun = Pick<RunHandle, "runId" | "decide" | "complete" | "close">;
export type SignedPressOptions = {
  press: PressFn;
  getRun: (callId: CallId) => Promise<SignerRun>;
  store: Store;
};

export type SignedPress = PressFn & {
  press: PressFn;
  closeCall: (callId: CallId, reason?: string) => Promise<void>;
  registerRun: (name: string, runKey: string) => Promise<SignerRun>;
  close: () => Promise<void>;
};

/** Gate each button at Tracekit before the healthcare control layer executes it. */
export function createSignedPress({ press, getRun, store }: SignedPressOptions): SignedPress {
  const runs = new Map<CallId, SignerRun>();
  const pendingRuns = new Map<CallId, Promise<SignerRun>>();

  async function runFor(callId: CallId): Promise<SignerRun> {
    const current = runs.get(callId);
    if (current) return current;
    const pending = pendingRuns.get(callId);
    if (pending) return pending;
    const created = getRun(callId).then((run) => {
      runs.set(callId, run);
      pendingRuns.delete(callId);
      return run;
    }, (error: unknown) => {
      pendingRuns.delete(callId);
      throw error;
    });
    pendingRuns.set(callId, created);
    return created;
  }

  async function noteFailure(callId: CallId, check: string, details: Record<string, unknown>): Promise<void> {
    await store.appendRecord({
      callId,
      actor: "system",
      kind: "safety",
      input: { check, ...details },
      decision: "blocked",
    }).catch(() => undefined);
  }

  const signed: PressFn = async (callId, button, input, suppliedContext?: PressContext) => {
    if (!BUTTON_NAMES.includes(button as ButtonName)) return { ok: false, error: "invalid_input", ruleIds: [] } as never;
    const invocationId = suppliedContext?.invocationId || `server-${randomUUID()}`;
    let run: SignerRun;
    try {
      run = await runFor(callId);
    } catch {
      await noteFailure(callId, "tracekit_unavailable", { button, invocationId });
      return press(callId, button, input, { invocationId, tracekit: { outcome: "unavailable", ruleIds: [] } });
    }

    const toolCallId = `${callId}:${invocationId}`;
    let decision: SignerDecision;
    try {
      decision = await run.decide(toolCallId, button, input, { tool_class_hint: "app" });
    } catch {
      await noteFailure(callId, "tracekit_decision_failed", { button, invocationId, runId: run.runId });
      return press(callId, button, input, {
        invocationId,
        tracekit: { runId: run.runId, outcome: "unavailable", ruleIds: [] },
      });
    }

    if (decision.unavailable) {
      await noteFailure(callId, "tracekit_unavailable", { button, invocationId, runId: run.runId });
      return press(callId, button, input, {
        invocationId,
        tracekit: { runId: run.runId, outcome: "unavailable", ruleIds: decision.rule_ids ?? [] },
      });
    }

    const tracekit = {
      runId: run.runId,
      decisionId: decision.decision_id,
      outcome: decision.decision,
      ruleIds: Array.isArray(decision.rule_ids) ? decision.rule_ids : [],
    } as const;
    const context: PressContext = { invocationId, tracekit };
    let result: ButtonResult;
    try {
      result = await press(callId, button, input, context);
    } catch {
      result = { ok: false, error: "refused", ruleIds: [] };
    }

    let completion: Frame | null;
    try {
      completion = await run.complete(toolCallId, result.ok ? "ok" : "error", {
        result_digest: argsDigest("aegis.button.result", { callId, button, result }),
      });
    } catch {
      completion = null;
    }
    if (completion === null) {
      await noteFailure(callId, "tracekit_result_unrecorded", { button, invocationId, runId: run.runId });
      return { ok: false, error: "refused", ruleIds: result.ruleIds } as never;
    }
    return result as never;
  };

  return Object.assign(signed, {
    press: signed,
    registerRun: getRun,
    async closeCall(callId: CallId, reason?: string) {
      const run = runs.get(callId);
      if (!run) return;
      runs.delete(callId);
      await run.close(reason).catch(() => undefined);
    },
    async close() {
      const active = [...runs.values()];
      runs.clear();
      await Promise.all(active.map((run) => run.close("application shutdown").catch(() => undefined)));
    },
  });
}

/** A production client. The live agent must use a separately operated signer endpoint. */
export function createTracekitRuntime(options: { signer?: string } = {}) {
  const signer = options.signer ?? process.env.TRACEKIT_SIGNER;
  if (!signer && process.env.NODE_ENV === "test") {
    return {
      async getRun(callId: CallId): Promise<SignerRun> {
        return this.registerRun("aegis-refill-guard", callId);
      },
      async registerRun(_name: string, runKey: string): Promise<SignerRun> {
        return {
          runId: `test-${argsDigest("aegis.test.run", { runKey }).slice(-16)}`,
          async decide(toolCallId, tool, args) {
            return { decision: "allow", decision_id: argsDigest("aegis.test.decision", { toolCallId, tool, args }), rule_ids: ["test-policy"] };
          },
          async complete() { return { event_id: "test-event" }; },
          async close() {},
        } as SignerRun;
      },
      async close() {},
    };
  }
  if (!signer) throw new Error("TRACEKIT_SIGNER is required before a live agent can start.");
  if (process.env.NODE_ENV === "production" && !signer.startsWith("https://")) {
    throw new Error("Production Tracekit signer connections must use HTTPS.");
  }
  const client = new Client({ signer });
  async function registerRun(name: string, runKey: string): Promise<SignerRun> {
    return client.registerRun(name, { run_key: runKey, service: "aegis" });
  }
  return {
    async getRun(callId: CallId): Promise<SignerRun> {
      return registerRun("aegis-refill-guard", callId);
    },
    registerRun,
    async close(): Promise<void> {
      await client.flush();
      await client.close();
    },
  };
}
