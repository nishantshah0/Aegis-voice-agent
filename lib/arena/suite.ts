import type { CallId, EmitFn, Seed } from "@/lib/contract";
import { runScenario, type Scenario, type ScenarioRun, type ScenarioSession, type ScenarioTarget } from "./runner";
import type { ScenarioScore } from "./score";

const attemptsPerScenario = 3;

export type SuiteScenario = Scenario & { group: string; needsPharmacist?: boolean };

type SuiteAttempt = ScenarioScore & { callId: CallId };

type SuiteOutcome = {
  id: string;
  group: string;
  passed: boolean;
  attempts: SuiteAttempt[];
};

export type SuiteReport = {
  totalScenarios: number;
  completed: boolean;
  passed: number;
  wrongOutcome: number;
  ordinaryWithoutPharmacist: { passed: number; total: number };
  caught: number;
  broken: number;
  /** Attempts that threw (the model failed, say) and were run again on a fresh session. */
  retried: number;
  scenarios: SuiteOutcome[];
};

export async function runScenarioSuite(options: {
  scenarios: readonly SuiteScenario[];
  seed: Seed;
  makeCode: () => string;
  makeSession: (seed: Seed, target: ScenarioTarget, code: string) => Promise<ScenarioSession>;
  saveReport: (report: SuiteReport) => Promise<void>;
  saveAttempt?: (scenarioId: string, attempt: number, result: ScenarioRun) => Promise<void>;
  concurrency?: number;
  /** How many times to rerun an attempt that threw, each on a fresh session. Default 0. */
  retries?: number;
  emit?: EmitFn;
}): Promise<SuiteReport> {
  const { scenarios, seed, makeCode, makeSession, saveReport, saveAttempt, concurrency = 2, retries = 0, emit } = options;
  let retried = 0;
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    throw new Error("scenario IDs must be unique");
  }
  if (!scenarios.length) throw new Error("scenario suite is empty");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");

  let report: SuiteReport = {
    totalScenarios: scenarios.length,
    completed: false,
    passed: 0,
    wrongOutcome: 0,
    ordinaryWithoutPharmacist: { passed: 0, total: 0 },
    caught: 0,
    broken: 0,
    retried: 0,
    scenarios: [],
  };

  const outcomes: (SuiteOutcome | undefined)[] = new Array(scenarios.length);
  let next = 0;
  let publishing = Promise.resolve();
  let failed = false;

  const snapshot = (): SuiteReport => {
    const finished = outcomes.filter((outcome): outcome is SuiteOutcome => outcome !== undefined);
    return {
      totalScenarios: scenarios.length,
      completed: finished.length === scenarios.length,
      passed: finished.filter((outcome) => outcome.passed).length,
      wrongOutcome: finished.filter((outcome) => outcome.group === "ordinary_patients" && !outcome.passed).length,
      ordinaryWithoutPharmacist: {
        passed: outcomes.reduce((n, outcome, i) => n + Number(outcome?.passed && scenarios[i].group === "ordinary_patients" && !scenarios[i].needsPharmacist), 0),
        total: outcomes.reduce((n, outcome, i) => n + Number(outcome !== undefined && scenarios[i].group === "ordinary_patients" && !scenarios[i].needsPharmacist), 0),
      },
      caught: finished.reduce((n, outcome) => n + outcome.attempts.reduce((m, attempt) => m + attempt.caught, 0), 0),
      broken: finished.reduce((n, outcome) => n + outcome.attempts.reduce((m, attempt) => m + attempt.broken, 0), 0),
      retried,
      scenarios: finished,
    };
  };

  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= scenarios.length) return;
      const scenario = scenarios[index];
    const attempts: SuiteAttempt[] = [];
    for (let attempt = 0; attempt < attemptsPerScenario; attempt++) {
      for (let tries = 0; ; tries++) {
        const code = makeCode();
        try {
          await runScenario({
            scenario,
            seed,
            code,
            makeSession: (fixture, target) => makeSession(fixture, target, code),
            saveResult: async (result) => {
              await saveAttempt?.(scenario.id, attempt + 1, result);
              attempts.push({ callId: result.callId, ...result.score });
            },
          });
          break;
        } catch (error) {
          if (tries >= retries) throw error;
          retried += 1;
        }
      }
    }

    const passed = attempts.every((attempt) => attempt.automatedPassed);
    const outcome = { id: scenario.id, group: scenario.group, passed, attempts };
      outcomes[index] = outcome;
      const current = snapshot();
      const write = publishing.then(async () => {
        await saveReport(current);
        emit?.({ type: "score", caught: current.caught, broken: current.broken });
      });
      publishing = write;
      await write;
    }
  };

  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, scenarios.length) }, () => worker().catch((error) => {
    failed = true;
    throw error;
  })));
  const rejection = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejection) throw rejection.reason;
  report = snapshot();

  return report;
}
