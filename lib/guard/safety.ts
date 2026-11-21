// The safety keyword check (SPEC Part 3, "Safety checks"). Runs on every caller line
// before the model sees it. False alarms are acceptable; missed emergencies are not.
// Role 1 adds the optional Haiku check behind the same function.

import type { CheckCallerLineFn, EmitFn, SafetyResult, Store } from "@/lib/contract";
import { words } from "./tokens";

export const EMERGENCY_SCRIPT =
  "This sounds like it could be an emergency. Please hang up and call 911 now, or call Poison Control if you took too much of a medicine.";
export const CRISIS_SCRIPT =
  "I'm really sorry you're going through this. You can call or text 9-8-8 any time to reach the Suicide Crisis Helpline. I'm also asking a pharmacist to check in on your refills.";
export const HANDOVER_SCRIPT = "Of course. I'm getting a pharmacist for you now.";

const EMERGENCY = [
  "cant breathe",
  "cannot breathe",
  "can not breathe",
  "trouble breathing",
  "hard to breathe",
  "short of breath",
  "struggling to breathe",
  "chest pain",
  "chest hurts",
  "my throat is closing",
  "throat closing",
  "throat is swelling",
  "tongue is swelling",
  "face is swelling",
  "lips are swelling",
  "swelling",
  "swollen",
  "overdose",
  "overdosed",
  "took too many",
  "taken too many",
  "took too much",
  "taken too much",
  "double dose",
  "passed out",
  "fainted",
  "unconscious",
  "seizure",
  "anaphylaxis",
  "allergic reaction",
  "hives",
];

const CRISIS = [
  "kill myself",
  "killing myself",
  "suicide",
  "suicidal",
  "end my life",
  "end it all",
  "hurt myself",
  "hurting myself",
  "harm myself",
  "self harm",
  "dont want to live",
  "dont want to be alive",
  "want to die",
  "better off dead",
  "no reason to live",
];

const HANDOVER = [
  "a person",
  "a real person",
  "a human",
  "real human",
  "speak to someone",
  "talk to someone",
  "speak to the pharmacist",
  "talk to the pharmacist",
  "speak to a pharmacist",
  "talk to a pharmacist",
  "the pharmacist please",
  "a pharmacist please",
  "representative",
  "operator",
  "a manager",
];

const hit = (text: string, phrases: string[]) => phrases.some((p) => text.includes(` ${p} `));

/** Pure keyword match. Crisis is checked first, then emergency, then handover. */
export function classify(line: string): SafetyResult {
  const w = words(line);
  if (hit(w, CRISIS)) return { action: "crisis", script: CRISIS_SCRIPT };
  if (hit(w, EMERGENCY)) return { action: "emergency", script: EMERGENCY_SCRIPT };
  if (hit(w, HANDOVER)) return { action: "handover", script: HANDOVER_SCRIPT };
  return { action: "continue" };
}

export function createSafetyCheck({ store, emit = () => {} }: { store: Store; emit?: EmitFn }): CheckCallerLineFn {
  return async function checkCallerLine(callId, line): Promise<SafetyResult> {
    const result = classify(line);
    try {
      const call = await store.getCall(callId);
      await store.appendRecord({ callId, actor: "caller", kind: "caller_line", input: { text: line }, decision: "allowed" });
      if (call) await store.saveCall({ ...call, callerSaid: [...call.callerSaid, line] });
      if (result.action === "continue") return result;

      await store.appendRecord({ callId, actor: "caller", kind: "safety", input: { text: line }, output: result, decision: "flagged" });
      const patientId = call?.lockedPatientId ?? call?.targetPatientId ?? "unknown";
      const item = await store.addQueueItem({
        callId,
        patientId,
        kind: "escalation",
        lane: "review",
        ruleIds: [],
        signals: ["safety_words"],
        notes: [{ id: `n_${callId}_safety`, kind: "question", text: `${result.action}: "${line}"` }],
      });
      emit({ type: "queue", item });
    } catch {
      // The keyword result stands even if the record can't be written.
    }
    return result;
  };
}
