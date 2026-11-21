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
  /** Attempts that threw (a dropped connection, say) and were run again on a fresh session. */
  retried: number;
  scenarios: SuiteOutcome[];
};

export async function runScenarioSuite(options: {
  scenarios: readonly SuiteScenario[];
  seed: Seed;
  makeCode: () => string;
  makeSession: (seed: Seed, target: ScenarioTarget, code: string) => Promise<ScenarioSession>;
  saveReport: (report: SuiteReport) => Promise<void>;
  /** Every attempt's full run, record included, as it finishes. */
  saveRun?: (scenario: SuiteScenario, attempt: number, run: ScenarioRun) => Promise<void>;
  /** How many times to rerun an attempt that threw, each on a fresh session. Default 0. */
  retries?: number;
  emit?: EmitFn;
}): Promise<SuiteReport> {
  const { scenarios, seed, makeCode, makeSession, saveReport, saveRun, retries = 0, emit } = options;
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    throw new Error("scenario IDs must be unique");
  }
  if (!scenarios.length) throw new Error("scenario suite is empty");

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
  let retried = 0;

  for (const scenario of scenarios) {
    const attempts: SuiteAttempt[] = [];
    for (let attempt = 0; attempt < attemptsPerScenario; attempt++) {
      for (let tries = 0; ; tries++) {
        const code = makeCode();
        try {
          const run = await runScenario({
            scenario,
            seed,
            code,
            makeSession: (fixture, target) => makeSession(fixture, target, code),
            saveResult: async () => {},
          });
          attempts.push({ callId: run.callId, ...run.score });
          await saveRun?.(scenario, attempt + 1, run);
          break;
        } catch (error) {
          if (tries >= retries) throw error;
          retried += 1;
        }
      }
    }

    const passed = attempts.every((attempt) => attempt.automatedPassed);
    const ordinary = scenario.group === "ordinary_patients";
    const noPharmacist = ordinary && !scenario.needsPharmacist;
    const outcome = { id: scenario.id, group: scenario.group, passed, attempts };
    report = {
      totalScenarios: scenarios.length,
      completed: report.scenarios.length + 1 === scenarios.length,
      passed: report.passed + Number(passed),
      wrongOutcome: report.wrongOutcome + Number(ordinary && !passed),
      ordinaryWithoutPharmacist: {
        passed: report.ordinaryWithoutPharmacist.passed + Number(noPharmacist && passed),
        total: report.ordinaryWithoutPharmacist.total + Number(noPharmacist),
      },
      caught: report.caught + attempts.reduce((total, attempt) => total + attempt.caught, 0),
      broken: report.broken + attempts.reduce((total, attempt) => total + attempt.broken, 0),
      retried,
      scenarios: [...report.scenarios, outcome],
    };
    await saveReport(report);
    emit?.({ type: "score", caught: report.caught, broken: report.broken });
  }

  return report;
}
