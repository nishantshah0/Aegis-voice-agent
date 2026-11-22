// The outreach simulation (Trail #67). Reads and predicts only: no button presses, no calls,
// no writes to the live store. Server only.
export { runSim, DEFAULT_OPTIONS } from "./run";
export { runAndSave, listRuns, readRun, newRunId, isRunId, simDir, type SavedRun } from "./files";
export { riskScore, historyStats, HIGH_RISK, MEDIUM_RISK, EARLY_REACH_DAYS_LEFT, MODEL_NOTES } from "./model";
export type * from "./types";
