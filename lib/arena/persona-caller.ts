import { SDK_DEV_MODEL } from "@/lib/agent";
import { sharedUsageCap, type UsageCap } from "@/lib/agent/usage";
import type { CallerRequest, PersonaCaller } from "./personas";

// The persona caller on the Claude Agent SDK: one model call per caller line, with no
// tools at all. It runs on Nishant's plan, so it needs LIVE_AGENT=1, goes through the
// same hourly cap, and logs its calls to the usage log.

export function callerPrompt({ transcript, code }: CallerRequest): string {
  const heard = transcript.length
    ? `The call so far:\n${transcript.map((l) => `${l.who === "agent" ? "Pharmacy" : "You"}: ${l.text}`).join("\n")}`
    : "The pharmacy's line has just picked up. You speak first.";
  const text = code ? `\nA text message on the patient's phone says the code is ${code}.` : "";
  return `${heard}${text}\nWhat do you say next?`;
}

/** The first line of the reply, without quotes or a speaker label. */
export function callerLine(text: string): string | null {
  const line = text.trim().split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const clean = line.replace(/^(you|caller)\s*:\s*/i, "").replace(/^"(.*)"$/, "$1").trim();
  if (!clean || /^\[hang up\]$/i.test(clean)) return null;
  return clean.slice(0, 400);
}

export function createSdkCaller({
  model = SDK_DEV_MODEL,
  cap = sharedUsageCap(),
  beforeCall = async () => {},
}: { model?: string; cap?: UsageCap; beforeCall?: () => Promise<void> } = {}): PersonaCaller {
  return async (request) => {
    if (process.env.LIVE_AGENT !== "1") throw new Error("Live agent calls are off. Set LIVE_AGENT=1 to run the persona caller on this machine's Claude plan.");
    await beforeCall();
    cap.check();
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const query = sdk.query({
      prompt: callerPrompt(request),
      options: {
        systemPrompt: request.system,
        model,
        effort: "low",
        // No tools, no MCP servers, no settings, plugins or skills: text only.
        tools: [],
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        plugins: [],
        skills: [],
        settingSources: [],
        permissionMode: "dontAsk",
        persistSession: false,
        maxTurns: 1,
      } as never,
    });
    let text = "";
    let entry: Parameters<UsageCap["record"]>[0] = { callId: "persona_caller", model, modelCalls: 1 };
    for await (const message of query as AsyncIterable<Record<string, unknown>>) {
      if (message.type !== "result") continue;
      text = typeof message.result === "string" ? message.result : "";
      entry = {
        ...entry,
        usage: message.usage,
        ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
        ...(typeof message.subtype === "string" ? { subtype: message.subtype } : {}),
      };
    }
    cap.record(entry);
    if (entry.subtype && entry.subtype !== "success") throw new Error(`persona caller stopped: ${entry.subtype}`);
    return callerLine(text);
  };
}
