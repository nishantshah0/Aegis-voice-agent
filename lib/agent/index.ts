// The real agent (Role 1). Server-only.
//   const driver = createAgentDriver({ calls: control, press: control.press,
//     guardSentence, checkCallerLine, model: createClaudeModel(), pharmacyName, emit });
export { createAgentDriver, MAX_STEPS, type AgentDriverOptions, type CallLifecycle, type ClaudeAgentDriver, type DriverStartOpts } from "./driver";
export { createClaudeModel, CALL_MODEL, type ClaudeModelOptions } from "./anthropic";
export { createAgentSdkModel, SDK_DEV_MODEL, SDK_MAX_TURNS, type AgentSdkModelOptions } from "./agent-sdk";
export { UsageCapError, CALLS_PER_HOUR, USAGE_LOG } from "./usage";
export type { AgentModel, ModelEvent, ModelRequest, ModelTurn, PressForModel } from "./model";
export { BUTTON_TOOLS } from "./tools";
export { createSentenceSplitter } from "./sentences";
export { systemPrompt } from "./prompt";
export * from "./lines";
