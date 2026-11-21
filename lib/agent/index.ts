// The real agent (Role 1). Server-only.
//   const driver = createAgentDriver({ calls: control, press: control.press,
//     guardSentence, checkCallerLine, model: createClaudeModel(), pharmacyName, emit });
export { createAgentDriver, MAX_STEPS, type AgentDriverOptions, type CallLifecycle, type ClaudeAgentDriver, type DriverStartOpts } from "./driver";
export { createClaudeModel, CALL_MODEL, type ClaudeModelOptions } from "./anthropic";
export type { AgentModel, ModelEvent, ModelRequest, ModelTurn } from "./model";
export { BUTTON_TOOLS } from "./tools";
export { createSentenceSplitter } from "./sentences";
export { systemPrompt } from "./prompt";
export * from "./lines";
