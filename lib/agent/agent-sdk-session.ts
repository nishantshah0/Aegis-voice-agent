// The real Claude Agent SDK session for one call. Server-only.
//
// One streaming-input query per call: each caller line is pushed in, and the turn
// is read until its result. Locked down so the model can act only through the
// 12 buttons:
//   tools: []                 no built-in tools (no Bash, Read, Write, Web, ...)
//   allowedTools              only mcp__buttons__<button>
//   permissionMode "dontAsk"  anything not allowed is denied, never asked
//   strictMcpConfig, no plugins or skills: no other MCP server's tools reach the agent
//   settingSources: []        no CLAUDE.md, settings or hooks from disk
//   persistSession: false     nothing written to ~/.claude/projects
// Live only with LIVE_AGENT=1: tests, the hammer, CI and scenario runs never
// spend Nishant's plan.

import type { ButtonTool, SdkSession, SdkTurnEvent } from "./agent-sdk";

type JsonProp = { type?: string; enum?: string[]; description?: string };
type JsonObjectSchema = { properties?: unknown; required?: unknown };
// The zod namespace, typed loosely so this file doesn't depend on zod's types.
type Zod = {
  string(): ZodLike;
  boolean(): ZodLike;
  enum(values: [string, ...string[]]): ZodLike;
};
type ZodLike = { describe(d: string): ZodLike; optional(): ZodLike };

/** A button's strict JSON schema as the zod shape the SDK's tool() takes. Strings, booleans and enums only. */
export function zodShape(z: Zod, schema: JsonObjectSchema): Record<string, ZodLike> {
  const props = (schema.properties ?? {}) as Record<string, JsonProp>;
  const required = new Set((schema.required ?? []) as string[]);
  const shape: Record<string, ZodLike> = {};
  for (const [key, p] of Object.entries(props)) {
    let field = p.enum?.length ? z.enum(p.enum as [string, ...string[]]) : p.type === "boolean" ? z.boolean() : z.string();
    if (p.description) field = field.describe(p.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

type UserMessage = { type: "user"; message: { role: "user"; content: string }; parent_tool_use_id: null; session_id: string };

/** A push-to iterable for the session's input. */
function inbox() {
  const queue: UserMessage[] = [];
  let wake: (() => void) | undefined;
  let open = true;
  return {
    push(m: UserMessage) {
      queue.push(m);
      wake?.();
    },
    end() {
      open = false;
      wake?.();
    },
    async *messages(): AsyncIterable<UserMessage> {
      while (open || queue.length) {
        if (queue.length) yield queue.shift()!;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

/** One model call per message id: the SDK streams each content block as its own assistant message. */
export function createCallCounter() {
  const ids = new Set<string>();
  const count = (id: string) => {
    ids.add(id);
    return ids.size;
  };
  count.total = () => ids.size;
  return count;
}

/** The session's options: the 12 buttons and nothing else (see the header). */
export function sessionOptions(opts: { system: string; tools: ButtonTool[]; model: string; maxTurns: number }, server: unknown) {
  return {
    systemPrompt: opts.system,
    model: opts.model,
    effort: "low" as const,
    tools: [] as string[],
    allowedTools: opts.tools.map((t) => `mcp__buttons__${t.name}`),
    mcpServers: { buttons: server },
    // Only our server: no MCP servers from user settings, .mcp.json or plugins reach the agent.
    strictMcpConfig: true,
    plugins: [] as never[],
    skills: [] as string[],
    permissionMode: "dontAsk" as const,
    settingSources: [] as never[],
    persistSession: false,
    includePartialMessages: true,
    // A ceiling for the whole call; the per-line limit of opts.maxTurns is enforced in send().
    maxTurns: opts.maxTurns * 25,
  };
}

export function startAgentSdkSession(opts: { system: string; tools: ButtonTool[]; model: string; maxTurns: number }): SdkSession {
  if (process.env.LIVE_AGENT !== "1") {
    throw new Error("Live agent calls are off. Set LIVE_AGENT=1 to run the Claude Agent SDK, which uses this machine's Claude plan.");
  }
  const input = inbox();
  const started = (async () => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const { z } = await import("zod");
    const server = sdk.createSdkMcpServer({
      name: "buttons",
      version: "1.0.0",
      tools: opts.tools.map((t) => {
        const shape = zodShape(z as unknown as Zod, t.schema) as unknown as Parameters<typeof sdk.tool>[2];
        return sdk.tool(t.name, t.description, shape, async (args) => {
          const r = await t.run(args);
          return { content: [{ type: "text" as const, text: r.content }], isError: r.isError };
        });
      }),
    });
    return sdk.query({ prompt: input.messages() as never, options: sessionOptions(opts, server) as never });
  })();

  let reader: AsyncIterator<unknown> | undefined;
  let callsSoFar = 0;

  return {
    async *send(text): AsyncIterable<SdkTurnEvent> {
      const query = await started;
      reader ??= (query as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      input.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" });
      const counter = createCallCounter();
      while (true) {
        const next = await reader.next();
        if (next.done) throw new Error("The Agent SDK session ended.");
        const msg = next.value as Record<string, unknown> & { type: string };
        if (msg.type === "stream_event" && msg.parent_tool_use_id === null) {
          const e = msg.event as { type: string; delta?: { type: string; text?: string } };
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) yield { type: "text", text: e.delta.text };
        } else if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
          const id = String((msg.message as { id?: unknown })?.id ?? msg.uuid);
          if (counter(id) > opts.maxTurns) {
            await query.interrupt();
            throw new Error(`The Agent SDK used more than ${opts.maxTurns} model calls for one caller line.`);
          }
        } else if (msg.type === "result") {
          const modelCalls = counter.total();
          const total = typeof msg.num_turns === "number" ? msg.num_turns : callsSoFar + modelCalls;
          const thisTurn = Math.max(modelCalls, total - callsSoFar);
          callsSoFar = total;
          yield {
            type: "result",
            text: typeof msg.result === "string" ? msg.result : "",
            isError: msg.is_error === true || msg.subtype !== "success",
            subtype: String(msg.subtype),
            stopReason: (msg.stop_reason as string | null) ?? null,
            modelCalls: thisTurn,
            usage: msg.usage,
            costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
          };
          return;
        }
      }
    },
    close() {
      input.end();
      started.then((q) => q.interrupt()).catch(() => {});
    },
  };
}
