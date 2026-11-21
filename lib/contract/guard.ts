// Speech guard (DESIGN 3.2) and safety check (DESIGN 3.3).
// Both are async because they read the call and its record from the Store.

import type { CallId, SpeechRule } from "./ids";

export type GuardResult =
  | { speak: string; blocked: false }
  | { speak: string; blocked: true; rule: SpeechRule; original: string };

/** Call once per sentence, before speech. Only `speak` may reach the voice. */
export type GuardSentenceFn = (callId: CallId, sentence: string) => Promise<GuardResult>;

export type SafetyResult =
  | { action: "continue" }
  | { action: "emergency" | "crisis" | "handover"; script: string };

/** Call on every caller line before the model sees it. */
export type CheckCallerLineFn = (callId: CallId, line: string) => Promise<SafetyResult>;

/** Fixed replacement lines (SPEC Part 3, "Speech rules"). */
export const GUARD_REPLACEMENTS: Record<Exclude<SpeechRule, "S4">, string> = {
  S1: "I can help with that once you're verified.",
  S2: "I can only discuss your own prescriptions.",
  S3: "Let me get the pharmacist to answer that.",
};
