// The agent's model on the Claude Agent SDK, for when there's no ANTHROPIC_API_KEY
// (HUMAN, 12:02). It runs on this machine's Claude Code login. Server-only.
//
// Same invariants as the Messages API path:
// - The 12 buttons are the only tools. Each one calls the driver's press, which
//   goes through control.press. The session turns off every built-in tool.
// - Text streams back to the driver, which splits it into sentences and sends each
//   through guardSentence. The caller's line went through checkCallerLine first.
// Usage is protected: Haiku while developing, at most 4 model calls per caller
// line, an hourly cap per process, and a log line per turn.

import type { ButtonName, CallId } from "@/lib/contract";
import type Anthropic from "@anthropic-ai/sdk";
import { startAgentSdkSession } from "./agent-sdk-session";
import type { AgentModel, ModelEvent, ModelRequest, PressForModel } from "./model";
import { BUTTON_TOOLS } from "./tools";
import { sharedUsageCap, type UsageCap } from "./usage";

/** HUMAN 12:02: claude-haiku-5-5 while developing; claude-sonnet-5-5 only for demo rehearsals (AGENT_SDK_MODEL). */
export const SDK_DEV_MODEL = "claude-haiku-5-5";
export const SDK_MAX_TURNS = 4;

export type ButtonTool = {
  name: ButtonName;
  description: string;
  schema: Anthropic.Beta.BetaTool["input_schema"];
  run(input: unknown): Promise<{ content: string; isError: boolean }>;
};

export type SdkTurnEvent =
  | { type: "text"; text: string }
  | {
      type: "result";
      text: string;
      isError: boolean;
      subtype: string;
      stopReason: string | null;
      /** Model calls this turn made. */
      modelCalls: number;
      usage?: unknown;
      costUsd?: number;
    };

/** One conversation for one call. send() plays one caller line to the end of its turn. */
export type SdkSession = { send(text: string): AsyncIterable<SdkTurnEvent>; close(): void };

export type StartSdkSession = (opts: { system: string; tools: ButtonTool[]; model: string; maxTurns: number }) => SdkSession;

/** The real session. It loads the SDK only when a session starts, so tests never import it. */
const startRealSession: StartSdkSession = (opts) => startAgentSdkSession(opts);

export type AgentSdkModelOptions = {
  startSession?: StartSdkSession;
  model?: string;
  cap?: UsageCap;
};

/** What the model hasn't seen yet, as one plain message: the caller's words and phone-system notes. */
function renderNew(messages: ModelRequest["messages"]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m.content !== "string") continue; // its own replies and tool results: the session has them
    if (m.role === "user") parts.push(m.content);
    else if (m.role === "system") parts.push(m.content);
    else parts.push(`(You said to the caller: "${m.content}")`);
  }
  return parts.join("\n") || "(The caller said nothing.)";
}

export function createAgentSdkModel({ startSession = startRealSession, model = process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL, cap = sharedUsageCap() }: AgentSdkModelOptions = {}): AgentModel {
  const calls = new Map<CallId, { session: SdkSession; seen: number; press: { current: PressForModel } }>();

  return {
    async *turn(request): AsyncIterable<ModelEvent> {
      const press = request.press;
      if (!press) throw new Error("The Agent SDK model presses buttons through the driver, so request.press is required.");
      cap.check();

      let call = calls.get(request.callId);
      if (!call) {
        const holder = { current: press };
        const tools: ButtonTool[] = BUTTON_TOOLS.map((t) => ({
          name: t.name as ButtonName,
          description: t.description ?? "",
          schema: t.input_schema,
          run: (input) => holder.current(t.name, input),
        }));
        call = { session: startSession({ system: request.system, tools, model, maxTurns: SDK_MAX_TURNS }), seen: 0, press: holder };
        calls.set(request.callId, call);
      }
      call.press.current = press; // this line's press, so its refills are tracked
      const text = renderNew(request.messages.slice(call.seen));
      call.seen = request.messages.length;

      let final: Extract<SdkTurnEvent, { type: "result" }> | undefined;
      for await (const event of call.session.send(text)) {
        if (event.type === "text") yield { type: "text", text: event.text };
        else final = event;
      }
      if (!final) throw new Error("The Agent SDK turn ended without a result.");
      cap.record({ callId: request.callId, model, modelCalls: final.modelCalls, usage: final.usage, costUsd: final.costUsd, subtype: final.subtype });
      if (final.isError) throw new Error(`The Agent SDK turn failed (${final.subtype}).`);

      const content = final.text ? [{ type: "text", text: final.text, citations: null } as Anthropic.Beta.BetaContentBlock] : [];
      yield { type: "done", turn: { stop_reason: final.stopReason === "refusal" ? "refusal" : "end_turn", content } };
    },

    endCall(callId) {
      calls.get(callId)?.session.close();
      calls.delete(callId);
    },
  };
}
