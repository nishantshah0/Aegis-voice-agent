import { join } from "node:path";
import type { RecordEntry } from "@/lib/contract";
import ordinaryRefill from "@/scenarios/sam-ordinary-refill.json";
import familyCallback from "./family-callback.json";
import greeting from "@/scenarios/greeting-slang-recovery.json";
import appointment from "@/scenarios/corrected-consultation-time.json";
import { replayTickets } from "../../_lib/replay-tickets";

export const scenarios = {
  family_callback: familyCallback,
  greeting_slang_recovery: greeting,
  sam_ordinary_refill: ordinaryRefill,
  corrected_consultation_time: appointment,
};
export type DemoScenarioId = keyof typeof scenarios;
export function isDemoScenario(id: unknown): id is DemoScenarioId {
  return typeof id === "string" && Object.hasOwn(scenarios, id);
}

type DemoLine = { type: "line"; speaker: "caller" | "pharmacy"; text: string; ticket?: string };
export type DemoEvent =
  | { type: "start"; scenarioId: DemoScenarioId }
  | DemoLine
  | { type: "action"; label: string }
  | { type: "check"; label: string; passed: boolean }
  | { type: "verdict"; passed: boolean; caught: number; broken: number }
  | { type: "error"; message: string };

const HIDDEN = "[Verification details omitted]";
const identityFields = /\b(?:date of birth|birthday|born|prescription number|verification code|my code|your code is|your code was|\brx[ -]?\d|tom brennan|sam rivera)\b/i;
const numbers = /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|hundred|thousand)\b/i;
const digitSequence = /(?:\d[\s.,-]*){5}|\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[ ,.-]+){4}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/i;

export function actionLabel(entry: RecordEntry): string | undefined {
  if (entry.kind === "line_blocked") return "Speech guard replaced a line";
  if (entry.kind !== "button" || !entry.button) return;
  const title = entry.button.replace(/_/g, " ");
  if (entry.decision === "blocked") return `Refused: ${title}`;
  if (entry.decision === "routed" || entry.decision === "flagged") return `Sent for review: ${title}`;
  if (entry.decision !== "allowed") return;
  if (entry.button === "order_status" && (entry.input as { include_appointments?: unknown })?.include_appointments === true) {
    return "Checked appointment availability";
  }
  const result = (entry.output as { result?: { output?: { verified?: boolean; appointment_id?: string } } })?.result?.output;
  if (entry.button === "check_code" && result?.verified === true) return "Verified caller identity";
  if (entry.button === "note_for_pharmacist" && result?.appointment_id) return "Reserved the pharmacist appointment";
  return `Completed: ${title}`;
}

export function redactPublicText(text: string, caller: boolean, identityPhase: boolean, code?: string): string {
  const privateLine = (identityPhase && (caller || numbers.test(text))) ||
    (code && text.replace(/\D/g, "").includes(code)) || digitSequence.test(text) || identityFields.test(text) || /\b(?:september|march|1983|1990)\b/i.test(text);
  return privateLine ? HIDDEN : text;
}

export function signedDemoLine(id: DemoScenarioId, line: DemoLine, seq: number): DemoLine {
  if (line.text === HIDDEN) return line;
  const kind = line.speaker === "caller" ? "caller_line" : "line_spoken";
  const ticket = replayTickets("public-simulation/" + id, [{ seq, kind, text: line.text }])?.[seq];
  return ticket ? { ...line, ticket } : line;
}

export function publicDemoLine(entry: RecordEntry, identityPhase: boolean, code: string): DemoLine | undefined {
  const blocked = entry.kind === "line_blocked";
  if (!blocked && entry.kind !== "caller_line" && entry.kind !== "line_spoken") return;
  const text: unknown = blocked
    ? (entry.output as { replacement?: unknown } | undefined)?.replacement
    : (entry.input as { text?: unknown } | undefined)?.text;
  if (typeof text !== "string" || !text.trim()) return;
  const caller = entry.kind === "caller_line";
  // The verified cards start with patient identification. No identity reply, even if
  // spelled aloud, is sent to the public transcript, saved file or voice provider.
  return { type: "line", speaker: caller ? "caller" : "pharmacy", text: redactPublicText(text, caller, identityPhase, code) };
}

export function liveResultsDirectory() {
  return join(/* turbopackIgnore: true */ process.env.RESULTS_DIR ?? join(process.cwd(), "results"), "simulation-live");
}
