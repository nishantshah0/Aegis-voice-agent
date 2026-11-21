// The speech guard and safety check (task 4.4). Server-only.
//   const guardSentence = createSpeechGuard({ store: getStore(), emit });
//   const checkCallerLine = createSafetyCheck({ store: getStore(), emit });
export { createSpeechGuard, isCompletionPromise, S4_REPLACEMENT } from "./speech";
export { createSafetyCheck, classify, EMERGENCY_SCRIPT, CRISIS_SCRIPT, HANDOVER_SCRIPT } from "./safety";
export { dosePhrases, unbackedDoses } from "./doses";
export { tokensFor, mentions, type Token } from "./tokens";
