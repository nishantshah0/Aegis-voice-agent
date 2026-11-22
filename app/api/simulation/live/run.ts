import Anthropic from "@anthropic-ai/sdk";
import { randomInt } from "node:crypto";
import { demoArchive } from "./archive";
import { CALL_MODEL, createClaudeModel, type AgentModel } from "@/lib/agent";
import { liveSessionMaker } from "@/lib/arena/live-session";
import { runScenario, type Scenario } from "@/lib/arena/runner";
import { SEED } from "@/lib/seed";
import { actionLabel, publicDemoLine, scenarios, signedDemoLine, type DemoEvent, type DemoScenarioId } from "./public-record";
export { isDemoScenario, publicDemoLine, type DemoEvent } from "./public-record";

export class DemoRunError extends Error {}

function providerFailure(error: unknown): DemoRunError {
  const detail = error as { name?: unknown; status?: unknown; error?: { type?: unknown; error?: { type?: unknown } } } | null;
  const status = detail?.status;
  const kind = detail?.error?.error?.type ?? detail?.error?.type;
  let report = "The model stream was interrupted.";
  if (detail?.name === "APIConnectionTimeoutError" || detail?.name === "TimeoutError") report = "The model request timed out.";
  else if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    report = `The model provider returned HTTP ${status}.`;
  } else if (kind === "overloaded_error" || kind === "rate_limit_error") report = "The model provider was busy.";
  else if (detail?.name === "APIConnectionError") report = "The model provider could not be reached.";
  return new DemoRunError(report + " No verdict was scored.");
}

function liveModel(signal: AbortSignal, failed: (reason: DemoRunError) => void): AgentModel {
  const client = new Anthropic({
    maxRetries: 0, timeout: 25_000,
    fetch: (input, init) => {
      const upstream = init?.signal;
      return fetch(input, { ...init, cache: "no-store", signal: upstream ? AbortSignal.any([signal, upstream]) : signal });
    },
  });
  const provider = createClaudeModel({ client, model: CALL_MODEL });
  return { async *turn(request) {
    signal.throwIfAborted();
    // Each fixed script has bounded caller turns and uses the pharmacy driver's step limit.
    try {
      yield* provider.turn(request);
    } catch (error) {
      const reason = providerFailure(error);
      failed(reason);
      throw reason;
    }
  } };
}

export async function runLiveDemo(id: DemoScenarioId, signal: AbortSignal, send: (event: DemoEvent) => void) {
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  let identityPhase = id !== "greeting_slang_recovery";
  const events: DemoEvent[] = [];
  const publish = (event: DemoEvent) => {
    signal.throwIfAborted();
    if (event.type === "line") {
      const { speaker, text } = event;
      events.push({ type: "line", speaker, text });
    } else events.push(event);
    send(event);
  };
  publish({ type: "start", scenarioId: id });
  let upstreamError: DemoRunError | undefined;
  const makeSession = liveSessionMaker({
    model: liveModel(signal, reason => { upstreamError ??= reason; }), code,
    beforeTurn: async () => signal.throwIfAborted(),
    async onRecord(_store, entry) {
      signal.throwIfAborted();
      if (entry.button === "check_code" && (entry.output as { result?: { output?: { verified?: boolean } } })?.result?.output?.verified) {
        identityPhase = false;
      }
      const action = actionLabel(entry);
      if (action) publish({ type: "action", label: action });
      const line = publicDemoLine(entry, identityPhase, code);
      if (!line) return;
      publish(signedDemoLine(id, line, entry.seq));
    },
  });
  const result = await runScenario({
    scenario: scenarios[id] as Scenario, seed: SEED, code,
    makeSession: (seed, target) => makeSession(seed, { ...target, patientPhone: true }),
    saveResult: async () => {}, // The raw record contains verification material.
  }).catch((error: unknown) => {
    // The scenario runner preserves failed attempts as errors; only expose our classified reason.
    throw upstreamError ?? error;
  });
  signal.throwIfAborted();
  for (const check of result.score.checks) publish({ type: "check", label: check.id.replace(/_/g, " "), passed: check.passed });
  const verdict: DemoEvent = { type: "verdict", passed: result.score.automatedPassed, caught: result.score.caught, broken: result.score.broken };
  await demoArchive().save(id, {
    scenarioId: id, model: CALL_MODEL, at: new Date().toISOString(), events: [...events, verdict],
  }, signal);
  publish(verdict);
}
