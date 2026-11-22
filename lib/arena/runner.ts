import type { AgentDriver, CallId, EmitFn, RecordEntry, Seed, Store } from "@/lib/contract";
import { IDS } from "@/lib/seed";
import { scoreScenario, type ScenarioExpected, type ScenarioScore } from "./score";

export type Scenario = {
  id: string;
  seed: keyof typeof targets;
  direction?: "inbound" | "outbound";
  caller_lines: string[];
  expected: ScenarioExpected;
};

export type ScenarioRun = {
  scenarioId: string;
  callId: CallId;
  callerLines: string[];
  record: RecordEntry[];
  score: ScenarioScore;
};

export type ScenarioTarget = { direction: "inbound" | "outbound"; patientId: string; rxId: string };

export type ScenarioSession = { store: Store; driver: AgentDriver; opening?: (callId: CallId) => Promise<void> };

const targets = {
  sam_due: { patientId: IDS.sam, rxId: IDS.samConcerta },
  sam_sync: { patientId: IDS.sam, rxId: IDS.samConcerta },
  p2_early: { patientId: IDS.p2, rxId: IDS.p2Atorvastatin },
  p3_expired: { patientId: IDS.p3, rxId: IDS.p3Lisinopril },
  p4_controlled_early: { patientId: IDS.p4, rxId: IDS.p4Adderall },
  p5_late: { patientId: IDS.p5, rxId: IDS.p5Levothyroxine },
  p6_due: { patientId: IDS.p6, rxId: IDS.p6Amlodipine },
  p6_no_refills: { patientId: IDS.p6, rxId: IDS.p6Amlodipine },
  p7_two_addresses: { patientId: IDS.p7, rxId: IDS.p7Sertraline },
} as const;

export function scenarioSeed(scenario: Scenario, seed: Seed): Seed {
  if (scenario.seed === "sam_sync") {
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      ...seed,
      prescriptions: seed.prescriptions.map((rx) => rx.id === IDS.samMetformin
        ? { ...rx, lastFill: new Date(Date.parse(seed.now) - rx.prescribedIntervalDays * dayMs).toISOString() }
        : rx),
    };
  }
  if (scenario.seed === "p6_no_refills") {
    return {
      ...seed,
      prescriptions: seed.prescriptions.map((rx) => rx.id === IDS.p6Amlodipine ? { ...rx, refillsLeft: 0 } : rx),
    };
  }
  return seed;
}

export function scenarioTokens(scenario: Scenario, seed: Seed, code: string): Record<string, string> {
  const target = targets[scenario.seed];
  if (!target) throw new Error(`unknown seed ${scenario.seed}`);
  const patient = seed.patients.find((entry) => entry.id === target.patientId);
  const rx = seed.prescriptions.find((entry) => entry.id === target.rxId);
  const otherRx = seed.prescriptions.find((entry) => entry.id === IDS.p8Rosuvastatin);
  if (!patient || !rx || !otherRx) throw new Error(`incomplete seed ${scenario.seed}`);
  const companion = seed.prescriptions.find((entry) => entry.id === IDS.samMetformin);
  const slot = seed.slots.find((entry) => entry.id === "slot_thu_am");
  const weeklyQuote = rx.supplyQuotes?.find((q) => q.days === 7);
  return {
    "patient.name": `${patient.firstName} ${patient.lastName}`,
    "patient.dob": patient.dob,
    "rx.number": rx.rxNumber,
    "rx.id": rx.id,
    "rx.name": rx.drug,
    "rx.patient_pays": rx.patientPays,
    "rx.last_fill_date": new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", month: "long", day: "numeric", year: "numeric" }).format(new Date(rx.lastFill)),
    ...(rx.lastDispensedQuantity ? { "rx.last_quantity": `${rx.lastDispensedQuantity.count} ${rx.lastDispensedQuantity.unit}` } : {}),
    ...(weeklyQuote ? { "rx.weekly_patient_pays": weeklyQuote.patientPays } : {}),
    code,
    wrong_code: `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`,
    "other_rx.id": otherRx.id,
    "other_rx.number": otherRx.rxNumber,
    "other_rx.patient_pays": otherRx.patientPays,
    ...(companion ? { "companion_rx.id": companion.id } : {}),
    ...(slot ? { "slot.id": slot.id, "slot.label": slot.label } : {}),
    ...(patient.addresses[0] ? { "home_address.id": patient.addresses[0].id } : {}),
  };
}

export function resolveScenarioText(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_token, name: string) => {
    if (!(name in tokens)) throw new Error(`unknown scenario token ${name}`);
    return tokens[name];
  });
}

export async function runScenario(options: {
  scenario: Scenario;
  seed: Seed;
  code: string;
  makeSession: (seed: Seed, target: ScenarioTarget) => Promise<ScenarioSession>;
  saveResult: (result: ScenarioRun) => Promise<void>;
  emit?: EmitFn;
}): Promise<ScenarioRun> {
  const { scenario, seed, code, makeSession, saveResult, emit } = options;
  const fixture = scenarioSeed(scenario, seed);
  const tokens = scenarioTokens(scenario, fixture, code);
  const resolve = (text: string) => resolveScenarioText(text, tokens);
  const callerLines = scenario.caller_lines.map(resolve);
  const direction = scenario.direction ?? "inbound";
  const target = { ...targets[scenario.seed], direction };
  const { store, driver, opening } = await makeSession(fixture, target);
  const callId = await driver.startCall({ direction, ...(direction === "outbound" ? { patientId: target.patientId } : {}) });
  if (direction === "outbound") {
    if (!opening) throw new Error("outbound scenario needs a guarded opener");
    await opening(callId);
  }

  const callerLineChecks: { id: string; passed: boolean; violation: true }[] = [];
  for (const [index, line] of callerLines.entries()) {
    const before = await store.listRecord(callId);
    for await (const event of driver.callerSays(callId, line)) {
      void event;
    }
    const after = await store.listRecord(callId);
    const passed = after.slice(before.length).some((entry) =>
      entry.kind === "caller_line" && entry.actor === "caller" &&
      (entry.input as { text?: string } | undefined)?.text === line,
    );
    callerLineChecks.push({ id: `caller_line_recorded:${index + 1}`, passed, violation: true });
  }

  await driver.endCall(callId);
  const record = await store.listRecord(callId);
  const scored = scoreScenario(scenario.expected, record, resolve);
  const checks = [...scored.checks, ...callerLineChecks];
  const score = {
    ...scored,
    checks,
    automatedPassed: checks.every((check) => check.passed),
    broken: scored.broken + callerLineChecks.filter((check) => !check.passed).length,
  };
  const result = { scenarioId: scenario.id, callId, callerLines, record, score };
  await saveResult(result);
  emit?.({ type: "score", caught: score.caught, broken: score.broken });
  return result;
}
