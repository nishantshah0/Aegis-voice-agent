// The real agent (task 1.2): an AgentDriver on Claude with the 12 buttons as tools.
//
// Each caller line:
//   1. goes through checkCallerLine before the model sees it;
//   2. then the model streams a turn; its text is split into sentences and every
//      sentence goes through guardSentence, and only `speak` is ever said;
//   3. every tool call is a press through the control layer, and its result,
//      whatever it is, goes back to the model as the tool result.
// The driver emits the lines it speaks; presses and blocked lines are emitted by
// the control layer and the guard (Role 2 DECISION: whoever produces it emits it).

import type Anthropic from "@anthropic-ai/sdk";
import type {
  AgentDriver,
  AgentEvent,
  ButtonResult,
  CallId,
  CheckCallerLineFn,
  Direction,
  EmitFn,
  GuardSentenceFn,
  PressFn,
  RxId,
  StartCallOpts,
} from "@/lib/contract";
import { outboundLookupId } from "@/lib/control";
import { HOLDING } from "./lines";
import type { AgentModel, ModelTurn } from "./model";
import { systemPrompt } from "./prompt";
import { createSentenceSplitter } from "./sentences";
import { BUTTON_TOOLS, isButtonName } from "./tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export type DriverStartOpts = StartCallOpts & { rxId?: RxId };

/** How calls start and end: the control layer (createControl) has both. */
export type CallLifecycle = {
  startCall(opts: DriverStartOpts): Promise<CallId>;
  endCall(callId: CallId): Promise<void>;
};

export type AgentDriverOptions = {
  calls: CallLifecycle;
  press: PressFn;
  guardSentence: GuardSentenceFn;
  checkCallerLine: CheckCallerLineFn;
  model: AgentModel;
  pharmacyName: string;
  emit?: EmitFn;
  /** Model turns allowed for one caller line before the agent hands over. */
  maxSteps?: number;
};

type CallState = {
  direction: Direction;
  messages: MessageParam[];
  /** What the phone system tells the model about this call (ids it needs to press). */
  callNote: string;
  /** Lines the caller heard instead of what the model wrote, told to the model next. */
  heardInstead: string[];
  ended: boolean;
};

export const MAX_STEPS = 8;
export const STUCK_REASON = "The agent could not finish the caller's request.";

/** An AgentDriver plus speakLine, for the scripted lines the agent opens a call with. */
export type ClaudeAgentDriver = AgentDriver & {
  startCall(opts: DriverStartOpts): Promise<CallId>;
  speakLine(callId: CallId, line: string): AsyncIterable<AgentEvent>;
};

export function createAgentDriver(options: AgentDriverOptions): ClaudeAgentDriver {
  const { calls, press, guardSentence, checkCallerLine, model, pharmacyName, emit = () => {}, maxSteps = MAX_STEPS } = options;
  const state = new Map<CallId, CallState>();

  /** Every word the agent says passes here, and only the guard's `speak` comes out. */
  async function* speak(callId: CallId, sentence: string): AsyncIterable<AgentEvent> {
    const guarded = await guardSentence(callId, sentence);
    if (guarded.blocked) {
      state.get(callId)?.heardInstead.push(`Instead of "${guarded.original}", the caller heard "${guarded.speak}".`);
      yield { type: "blocked_line", rule: guarded.rule, original: guarded.original, replacement: guarded.speak };
    }
    emit({ type: "line", callId, who: "agent", text: guarded.speak });
    yield { type: "line", text: guarded.speak };
  }

  function pushUser(call: CallState, content: MessageParam["content"]) {
    call.messages.push({ role: "user", content } as MessageParam);
    if (call.heardInstead.length) {
      call.messages.push({ role: "system", content: `Phone system: ${call.heardInstead.join(" ")}` } as MessageParam);
      call.heardInstead = [];
    }
  }

  async function* pressAll(callId: CallId, turn: ModelTurn): AsyncGenerator<AgentEvent, ToolResult[]> {
    const results: ToolResult[] = [];
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      if (!isButtonName(block.name)) {
        results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: JSON.stringify({ error: "no such button" }) });
        continue;
      }
      const result: ButtonResult = await press(callId, block.name, block.input);
      yield { type: "press", button: block.name, input: block.input, result };
      results.push({ type: "tool_result", tool_use_id: block.id, is_error: !result.ok, content: JSON.stringify(forModel(result)) });
    }
    return results;
  }

  /** Hand the call to a pharmacist, through the escalate button like any other action. */
  async function* handOver(callId: CallId, reason: string): AsyncIterable<AgentEvent> {
    const result = await press(callId, "escalate", { reason });
    yield { type: "press", button: "escalate", input: { reason }, result };
    yield* speak(callId, "Let me get a pharmacist to help you with that.");
  }

  return {
    async startCall(opts) {
      const callId = await calls.startCall(opts);
      state.set(callId, {
        direction: opts.direction,
        messages: [],
        callNote: callNote(callId, opts),
        heardInstead: [],
        ended: false,
      });
      return callId;
    },

    async *speakLine(callId, line) {
      const call = state.get(callId);
      if (!call || call.ended) return;
      call.callNote += `\nYou have already said to the caller: "${line}"`;
      yield* speak(callId, line);
    },

    async *callerSays(callId, text) {
      const call = state.get(callId);
      if (!call || call.ended) {
        yield { type: "ended" };
        return;
      }
      emit({ type: "line", callId, who: "caller", text });

      const safety = await checkCallerLine(callId, text);
      if (safety.action !== "continue") {
        yield { type: "safety", result: safety };
        pushUser(call, text);
        call.messages.push({ role: "assistant", content: safety.script });
        yield* speak(callId, safety.script);
        return;
      }

      pushUser(call, text);
      const system = `${systemPrompt({ pharmacyName, direction: call.direction })}\n\n${call.callNote}`.trim();

      for (let step = 0; step < maxSteps; step++) {
        const splitter = createSentenceSplitter();
        let turn: ModelTurn | undefined;
        for await (const event of model.turn({ system, messages: call.messages, tools: BUTTON_TOOLS })) {
          if (event.type === "done") turn = event.turn;
          else for (const sentence of splitter.push(event.text)) yield* speak(callId, sentence);
        }
        for (const sentence of splitter.flush()) yield* speak(callId, sentence);

        if (!turn || turn.stop_reason === "refusal") {
          yield* handOver(callId, "The assistant could not continue this call.");
          return;
        }
        call.messages.push({ role: "assistant", content: turn.content } as MessageParam);
        if (turn.stop_reason !== "tool_use") return;

        const results = yield* pressAll(callId, turn);
        if (results.length === 0) return;
        pushUser(call, results);
      }

      // Too many steps for one line: say so plainly and get a person.
      yield* speak(callId, HOLDING);
      yield* handOver(callId, STUCK_REASON);
    },

    async endCall(callId) {
      const call = state.get(callId);
      if (call) call.ended = true;
      await calls.endCall(callId);
      state.delete(callId);
    },
  };
}

/** What the model sees from a press: the button's own output, or its error, and the rule numbers. */
function forModel(result: ButtonResult): Record<string, unknown> {
  if (result.ok) return { ...(result.output as object), rule_ids: result.ruleIds };
  return { error: result.error, rule_ids: result.ruleIds };
}

/** Ids the model needs to press on this call. Opaque ids only: no patient detail. */
function callNote(callId: CallId, opts: DriverStartOpts): string {
  if (opts.direction !== "outbound") return "";
  const lines = [`For this call, the lookup id is ${outboundLookupId(callId)}.`];
  if (opts.rxId) lines.push(`The prescription this call is about has rx_id ${opts.rxId}.`);
  return lines.join("\n");
}
