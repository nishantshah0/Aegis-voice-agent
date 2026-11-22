import type { RecordEntry } from "@/lib/contract";
import { recordMatches, type ScenarioCheck, type CheckResult, type RecordMatch } from "@/lib/arena/score";
import type { Entry } from "../data";

type Definition = ScenarioCheck;
type Expectations = { checks: Definition[]; final_states: Record<string, string> };
type Event = { entry: RecordEntry; turn: number };
type RelatedEvent = { turn?: number; seq: number; observed: string };
export type FailureEvidence = { id: string; expected: string; observed: string; turn?: number; seq?: number; related?: RelatedEvent };

const label = (s: string) => s.replace(/[_:]/g, " ");
const hiddenCode = "[verification code omitted]";

export function safeScenarioText(text: string): string {
  // Also catches spoken or spaced digit sequences; the page and its replay tickets
  // must receive the same safe text.
  return text.replace(/\b(?:\d[ -]?){5}\d\b/g, hiddenCode)
    .replace(/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)[ -]+){5}(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/gi, hiddenCode);
}

export function displayRecord(entries: Entry[]): Entry[] {
  const verificationTurns = new Set<number>();
  let turn = 0;
  for (const e of entries) {
    if (e.kind === "caller_line" && e.actor === "caller") turn++;
    if (e.button === "check_code") verificationTurns.add(turn);
  }
  turn = 0;
  return entries.map(e => {
    if (e.kind === "caller_line" && e.actor === "caller") turn++;
    const safe: Entry = {
      seq: e.seq, kind: e.kind, actor: e.actor, decision: e.decision, ruleIds: e.ruleIds,
      hash: e.hash, prevHash: e.prevHash, button: e.button, rule: e.rule,
    };
    if (e.text && (e.kind === "line_spoken" || e.kind === "caller_line" || e.kind === "safety")) {
      safe.text = verificationTurns.has(turn) && e.kind === "caller_line" ? hiddenCode : safeScenarioText(e.text);
    }
    if (e.replacement) safe.replacement = safeScenarioText(e.replacement);
    return safe;
  });
}

function describeMatch(m?: RecordMatch): string {
  if (!m) return "the expected event";
  const parts = [m.button ? label(m.button) : label(m.kind ?? "record entry")];
  if (m.decision) parts.push(m.decision);
  if (m.inputRxId) parts.push(`for ${m.inputRxId}`);
  if (m.resultState) parts.push(`with state ${label(m.resultState)}`);
  if (m.resultError) parts.push(`with error ${label(m.resultError)}`);
  if (m.resultVerified !== undefined) parts.push(m.resultVerified ? "verifying the caller" : "refusing verification");
  if (m.ruleId) parts.push(`under rule ${m.ruleId}`);
  if (m.lane) parts.push(`in ${label(m.lane)}`);
  if (m.inputKind || m.inputCheck) parts.push(label(m.inputKind ?? m.inputCheck!));
  if (m.inputDaysSupply ?? m.resultDaysSupply) parts.push(`for ${m.inputDaysSupply ?? m.resultDaysSupply} days`);
  if (m.resultBookedSlot || m.inputSlotId) parts.push(`for slot ${m.resultBookedSlot ?? m.inputSlotId}`);
  if (m.inputAddressId) parts.push(`at ${m.inputAddressId}`);
  if (m.safetyAction) parts.push(label(m.safetyAction));
  if (m.textIncludes) parts.push(m.kind === "line_blocked" ? "matching the blocked-line check" : `including “${safeScenarioText(m.textIncludes)}”`);
  return parts.join(" ");
}

function expectation(c: Definition) {
  const match = describeMatch(c.match);
  switch (c.mode) {
    case "before": return `${describeMatch(c.first)} before ${describeMatch(c.then)}`;
    case "absent": return `No ${match}`;
    case "any": return (c.matches ?? []).map(describeMatch).join(" or ");
    case "count": return `Exactly ${c.count} matching events for ${match}`;
    default: return match;
  }
}

export function failuresForAttempt(
  score: Pick<CheckResult, "id" | "passed">[],
  expected: Expectations | undefined,
  record: RecordEntry[],
  visible: Entry[],
  resolve: (value: string) => string,
): FailureEvidence[] {
  let turn = 0;
  const events: Event[] = record.map(entry => {
    if (entry.kind === "caller_line" && entry.actor === "caller") turn++;
    return { entry, turn };
  });
  const shown = new Map(visible.map(e => [e.seq, e]));
  const unresolved = (id: string, expected: string): FailureEvidence => ({
    id, expected, observed: "The saved verdict failed. The available check definition and record do not establish a specific event.",
  });
  const observedEvent = (e: Event): RelatedEvent => {
    const v = shown.get(e.entry.seq);
    let observed = "";
    if (v?.button) observed = `${label(v.button)} · ${v.decision || "recorded"}`;
    else if (v?.kind === "line_blocked") observed = `Line replaced${v.replacement ? ` with “${v.replacement}”` : ""}`;
    else if (v?.text) observed = `${v.actor === "caller" ? "Caller" : "Pharmacy"} said “${v.text}”`;
    else observed = label(e.entry.kind);
    return { observed, seq: e.entry.seq, turn: e.turn || undefined };
  };
  const at = (id: string, desc: string, e: Event, reason: string): FailureEvidence => {
    const location = observedEvent(e);
    return { id, expected: desc, ...location, observed: `${location.observed}. ${reason}` };
  };
  return score.filter(c => !c.passed).map(({ id }) => {
    if (id.startsWith("caller_line_recorded:")) {
      const target = Number(id.slice(id.lastIndexOf(":") + 1));
      return { id, expected: `A recorded caller line for scripted turn ${target}`, observed: "The expected caller line was missing by call end." };
    }
    if (id.startsWith("final:")) {
      const rxId = id.slice(6);
      const final = Object.entries(expected?.final_states ?? {}).find(([key]) => resolve(key) === rxId);
      if (!final) return unresolved(id, label(id));
      const desc = `Final refill state ${label(final[1])} for ${rxId}`;
      const latest = events.findLast(e => recordMatches(e.entry, { button: "request_refill", inputRxId: rxId }));
      if (!latest) return { id, expected: desc, observed: "No matching refill request was recorded by call end." };
      if (recordMatches(latest.entry, { resultState: final[1] })) return unresolved(id, desc);
      const result = (latest.entry.output as { result?: { error?: string; output?: { state?: string } } })?.result;
      const actual = result?.output?.state ?? result?.error;
      return at(id, desc, latest, actual ? `The last refill result was ${label(actual)}.` : "The expected final state was absent from the last refill result.");
    }
    const definition = expected?.checks.find(c => c.id === id);
    if (!definition) return unresolved(id, label(id));
    const desc = expectation(definition) + (definition.turn ? ` on caller turn ${definition.turn}` : "");
    const scoped = definition.turn === undefined ? events : events.filter(e => e.turn === definition.turn);
    if (definition.turn && !scoped.length) {
      return { id, expected: desc, observed: `Caller turn ${definition.turn} was missing from the record by call end.` };
    }
    const matching = (m?: RecordMatch) => {
      if (!m) return [];
      const resolved = Object.fromEntries(Object.entries(m).map(([key,value]) => [key, typeof value === "string" ? resolve(value) : value]));
      if (JSON.stringify(resolved).includes("{{")) return undefined;
      return scoped.filter(e => recordMatches(e.entry, resolved));
    };
    const missing = (observed: string, m?: RecordMatch): FailureEvidence => {
      // A different response on the expected turn is context for the operator;
      // a missing event itself still has no sequence number.
      const candidates = scoped.filter(e => m?.button
        ? e.entry.button === m.button && (!m.inputRxId || recordMatches(e.entry, { inputRxId: resolve(m.inputRxId) }))
        : definition.turn && m?.kind === "line_spoken" && (e.entry.kind === "line_spoken" || e.entry.kind === "line_blocked"));
      const relevant = candidates.at(-1);
      return { id, expected: desc, observed, ...(relevant ? { related: observedEvent(relevant) } : {}) };
    };
    if (definition.mode === "before") {
      const first = matching(definition.first), then = matching(definition.then);
      if (!first || !then) return unresolved(id, desc);
      const misplaced = then.find(b => !first.some(a => a.entry.seq < b.entry.seq));
      if (misplaced) return at(id, desc, misplaced, "The required earlier event had not occurred.");
      if (then.length) return unresolved(id, desc);
      return missing("The required follow-up event was missing by call end.", definition.then);
    }
    const matches = matching(definition.match);
    if (!matches) return unresolved(id, desc);
    if (definition.mode === "absent") return matches[0] ? at(id, desc, matches[0], "This event was prohibited by the check.") : unresolved(id, desc);
    if (definition.mode === "count" && definition.count !== undefined) {
      const excess = matches[definition.count];
      if (excess) return at(id, desc, excess, `This exceeded the expected count. The record contains ${matches.length} matches.`);
      if (matches.length === definition.count) return unresolved(id, desc);
      return { id, expected: desc, observed: `${matches.length} matching events were recorded by call end.` };
    }
    if (definition.mode === "present" && matches.length) return unresolved(id, desc);
    if (definition.mode === "any") {
      const alternatives = definition.matches?.map(matching);
      if (!alternatives?.length || alternatives.some(a => !a || a.length)) return unresolved(id, desc);
    }
    return missing("No matching event was recorded by call end.", definition.match);
  });
}
