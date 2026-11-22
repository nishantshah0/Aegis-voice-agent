import type { AgentDriver, CallId, RecordEntry, Seed, Store } from "@/lib/contract";
import { createAgentDriver, type AgentModel } from "@/lib/agent";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { PHARMACY_NAME } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import type { ScenarioSession, ScenarioTarget } from "./runner";

// One scenario attempt on the live agent: a fresh in-memory store from the scenario's
// seed, the real lock (control, speech guard, safety check), and Role 1's agent driver
// on the given model. Nothing here touches the live server's store or event stream.

/** Called with each record entry as it's written, and the store at that moment. */
export type OnRecord = (store: Store, entry: RecordEntry) => Promise<void>;

/** The same store, with every appended record entry handed to onRecord first. */
export function watchStore(store: Store, onRecord?: OnRecord): Store {
  if (!onRecord) return store;
  const watched: Store = {
    ...store,
    async appendRecord(input) {
      const entry = await store.appendRecord(input);
      await onRecord(watched, entry);
      return entry;
    },
  };
  return watched;
}

export function liveSessionMaker({
  model,
  code,
  beforeTurn = async () => {},
  onRecord,
}: {
  model: AgentModel;
  /** The code the control layer sends, so caller lines that read {{code}} verify. */
  code: string;
  /** Called before each caller line, e.g. to wait for room under the hourly cap. */
  beforeTurn?: () => Promise<void>;
  /** Sees every record entry as it's written (the overnight run's invariant checks). */
  onRecord?: OnRecord;
}) {
  return async (seed: Seed, target: ScenarioTarget): Promise<ScenarioSession> => {
    const store = watchStore(createMemoryStore(seed), onRecord);
    const control = createControl({ store, makeCode: () => code });
    // The driver turns a model failure into a hand-over, which would score as the
    // agent's own choice. Note it instead, so the attempt is rerun, never scored.
    let failure: unknown;
    const watched: AgentModel = {
      ...model,
      async *turn(request) {
        try {
          yield* model.turn(request);
        } catch (error) {
          failure ??= error;
          throw error;
        }
      },
    };
    const agent = createAgentDriver({
      // Outbound calls go through rule 7 for the scenario's own prescription.
      calls: { startCall: (opts) => control.startCall({ ...opts, rxId: target.rxId }), endCall: control.endCall },
      press: control.press,
      guardSentence: createSpeechGuard({ store }),
      checkCallerLine: createSafetyCheck({ store }),
      model: watched,
      pharmacyName: PHARMACY_NAME,
    });
    const patient = seed.patients.find((p) => p.id === target.patientId);
    const driver: AgentDriver = {
      // The live phone passes the name the opener says when it answers; so do we.
      startCall: (opts) => agent.startCall(opts.direction === "outbound" && patient ? { ...opts, patientName: `${patient.firstName} ${patient.lastName}` } : opts),
      async endCall(callId) {
        await agent.endCall(callId);
        if (failure) throw new Error(`model failed, attempt not scored: ${failure instanceof Error ? failure.message : String(failure)}`);
      },
      async *callerSays(callId, line) {
        await beforeTurn();
        yield* agent.callerSays(callId, line);
      },
    };
    const opening = async (callId: CallId) => {
      for await (const event of agent.opening(callId)) void event;
    };
    return { store, driver, opening };
  };
}
