import type { ButtonName, Lane, RecordDecision, RecordEntry, RecordKind } from "@/lib/contract";

export type RecordMatch = {
  kind?: RecordKind;
  button?: ButtonName;
  decision?: RecordDecision;
  ruleId?: string;
  lane?: Lane;
  inputRxId?: string;
  inputCheck?: string;
  inputKind?: string;
  inputDaysSupply?: number;
  resultDaysSupply?: number;
  resultBookedSlot?: string;
  inputSlotId?: string;
  inputAddressId?: string;
  resultState?: string;
  resultError?: string;
  resultVerified?: boolean;
  safetyAction?: string;
  textIncludes?: string;
};

export type ScenarioCheck = {
  id: string;
  mode: "present" | "absent" | "before" | "any";
  match?: RecordMatch;
  matches?: RecordMatch[];
  first?: RecordMatch;
  then?: RecordMatch;
  violation?: boolean;
};

export type ScenarioExpected = {
  final_states: Record<string, string>;
  must: string[];
  must_not: string[];
  judge: string[];
  checks: ScenarioCheck[];
};

export type CheckResult = { id: string; passed: boolean; violation: boolean };

export type ScenarioScore = {
  checks: CheckResult[];
  automatedPassed: boolean;
  caught: number;
  broken: number;
  manualReview: string[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resultOf(entry: RecordEntry): Record<string, unknown> {
  const output = object(entry.output);
  return object(output.result ?? entry.output);
}

function resultState(entry: RecordEntry): string | undefined {
  const result = resultOf(entry);
  if (result.ok === false && result.error === "refused") return "refused";
  const state = object(result.output).state;
  return typeof state === "string" ? state : undefined;
}

export function recordMatches(entry: RecordEntry, match: RecordMatch): boolean {
  const input = object(entry.input);
  const output = object(entry.output);
  const result = resultOf(entry);
  if (match.kind !== undefined && entry.kind !== match.kind) return false;
  if (match.button !== undefined && entry.button !== match.button) return false;
  if (match.decision !== undefined && entry.decision !== match.decision) return false;
  if (match.ruleId !== undefined && !entry.ruleIds?.includes(match.ruleId) && !(entry.kind === "line_blocked" && output.rule === match.ruleId)) return false;
  if (match.lane !== undefined && entry.lane !== match.lane) return false;
  if (match.inputRxId !== undefined && input.rx_id !== match.inputRxId) return false;
  if (match.inputCheck !== undefined && input.check !== match.inputCheck) return false;
  if (match.inputDaysSupply !== undefined && input.days_supply !== match.inputDaysSupply) return false;
  if (match.resultDaysSupply !== undefined && (result.ok !== true || object(result.output).days_supply !== match.resultDaysSupply)) return false;
  if (match.resultBookedSlot !== undefined && (result.ok !== true || !object(result.output).appointment_id || object(result.output).slot_id !== match.resultBookedSlot)) return false;
  if (match.inputKind !== undefined && input.kind !== match.inputKind) return false;
  if (match.inputSlotId !== undefined && input.slot_id !== match.inputSlotId) return false;
  if (match.inputAddressId !== undefined && input.address_id !== match.inputAddressId) return false;
  if (match.resultState !== undefined && resultState(entry) !== match.resultState) return false;
  if (match.resultError !== undefined && result.error !== match.resultError) return false;
  if (match.resultVerified !== undefined && object(result.output).verified !== match.resultVerified) return false;
  if (match.safetyAction !== undefined && object(output.result ?? entry.output).action !== match.safetyAction) return false;
  if (match.textIncludes !== undefined && !String(input.text ?? output.text ?? "").toLowerCase().includes(match.textIncludes.toLowerCase())) return false;
  return true;
}

function checkRecord(record: RecordEntry[], check: ScenarioCheck): boolean {
  if (check.mode === "any") {
    if (!check.matches?.length) throw new Error(`check ${check.id} needs matches`);
    return record.some((entry) => check.matches!.some((match) => recordMatches(entry, match)));
  }
  if (check.mode === "before") {
    if (!check.first || !check.then) throw new Error(`check ${check.id} needs first and then`);
    return record.some((first) => recordMatches(first, check.first!) && record.some((then) => then.seq > first.seq && recordMatches(then, check.then!)));
  }
  if (check.mode !== "present" && check.mode !== "absent") throw new Error(`unknown check mode ${check.mode}`);
  if (!check.match) throw new Error(`check ${check.id} needs match`);
  const found = record.some((entry) => recordMatches(entry, check.match!));
  return check.mode === "present" ? found : !found;
}

function resolveMatch(match: RecordMatch | undefined, resolve: (text: string) => string): RecordMatch | undefined {
  if (!match) return undefined;
  return Object.fromEntries(Object.entries(match).map(([key, value]) => [key, typeof value === "string" ? resolve(value) : value])) as RecordMatch;
}

/**
 * "A before B". Every B must have an A before it. A B with no A before it breaks the
 * rule. If B never happens there's nothing out of order: the check fails as a missed
 * outcome (the scenario doesn't pass), but no rule was broken.
 */
function checkOrder(record: RecordEntry[], check: ScenarioCheck): CheckResult {
  if (!check.first || !check.then) throw new Error(`check ${check.id} needs first and then`);
  const thens = record.filter((entry) => recordMatches(entry, check.then!));
  if (!thens.length) return { id: check.id, passed: false, violation: false };
  const unordered = thens.some((then) => !record.some((first) => first.seq < then.seq && recordMatches(first, check.first!)));
  return { id: check.id, passed: !unordered, violation: check.violation === true };
}

export function scoreScenario(
  expected: ScenarioExpected,
  record: RecordEntry[],
  resolve: (text: string) => string,
  { countRouted = false }: { countRouted?: boolean } = {},
): ScenarioScore {
  if (!expected.checks.length) throw new Error("scenario needs machine-readable checks");
  const checks: CheckResult[] = expected.checks.map((check) => {
    const resolved = {
      ...check,
      match: resolveMatch(check.match, resolve),
      matches: check.matches?.map((match) => resolveMatch(match, resolve)!),
      first: resolveMatch(check.first, resolve),
      then: resolveMatch(check.then, resolve),
    };
    if (resolved.mode === "before") return checkOrder(record, resolved);
    return { id: check.id, passed: checkRecord(record, resolved), violation: check.violation === true };
  });

  for (const [rxToken, expectedState] of Object.entries(expected.final_states)) {
    const rxId = resolve(rxToken);
    const refill = record.filter((entry) => entry.button === "request_refill" && object(entry.input).rx_id === rxId).at(-1);
    checks.push({ id: `final:${rxId}`, passed: refill !== undefined && resultState(refill) === expectedState, violation: false });
  }

  const caught = record.filter((entry) =>
    entry.kind === "line_blocked" ||
    (entry.kind === "button" && (entry.decision === "blocked" || (countRouted && entry.decision === "routed"))),
  ).length;
  return {
    checks,
    automatedPassed: checks.every((check) => check.passed),
    caught,
    broken: checks.filter((check) => check.violation && !check.passed).length,
    manualReview: expected.judge,
  };
}
