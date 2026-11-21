// The real agent (tasks 1.2 and 1.3): an AgentDriver on Claude with the 12 buttons as tools.
//
// Each caller line:
//   1. goes through checkCallerLine before the model sees it;
//   2. then the model streams a turn; its text is split into sentences and every
//      sentence goes through guardSentence, and only `speak` is ever said;
//   3. every tool call is a press through the control layer, and its result,
//      whatever it is, goes back to the model as the tool result.
// The fixed lines (greeting, outbound opener, side-effect question) are spoken by
// the driver itself, still through guardSentence, and its own presses (send_code,
// read_label) still go through the control layer.
// The driver emits the lines it speaks; presses and blocked lines are emitted by
// the control layer and the guard (Role 2 DECISION: whoever produces it emits it).

import type Anthropic from "@anthropic-ai/sdk";
import type {
  AgentDriver,
  AgentEvent,
  ButtonInputs,
  ButtonName,
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
import { HOLDING, SIDE_EFFECT_PASSED_ON, inboundGreeting, outboundOpener, sideEffectQuestion } from "./lines";
import type { AgentModel, ModelTurn } from "./model";
import { systemPrompt } from "./prompt";
import { createSentenceSplitter } from "./sentences";
import { BUTTON_TOOLS, isButtonName } from "./tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export type DriverStartOpts = StartCallOpts & {
  /** Outbound: the prescription the daily check rang about (rule 7 checks it). */
  rxId?: RxId;
  /** Outbound: the name the fixed opener says (S1's one exception). Passed in, never read by the driver. */
  patientName?: string;
};

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
  rxId?: RxId;
  patientName?: string;
  messages: MessageParam[];
  /** What the phone system tells the model about this call (ids it needs to press). */
  callNote: string;
  /** Notes for the model, sent as one system message after the next user message. */
  notes: string[];
  /** Prescriptions refilled this call whose side-effect question has been asked. */
  askedSideEffects: Set<RxId>;
  /** Set right after the side-effect question, so the caller's answer is read as one. */
  awaitingSideEffect?: RxId;
  ended: boolean;
};

export const MAX_STEPS = 8;
export const STUCK_REASON = "The agent could not finish the caller's request.";
export const HANDOVER_LINE = "Let me get a pharmacist to help you with that.";

/** Refill states that mean a refill is going ahead, so the side-effect question follows. */
const REFILL_GOING_AHEAD = new Set(["queued", "waiting_for_pharmacist", "approved"]);

export type ClaudeAgentDriver = AgentDriver & {
  startCall(opts: DriverStartOpts): Promise<CallId>;
  /** Pick up a call something else started, such as the daily check's outbound call. */
  joinCall(callId: CallId, opts: DriverStartOpts): void;
  /** The fixed opening: the inbound greeting, or the outbound opener and then the code. */
  opening(callId: CallId): AsyncIterable<AgentEvent>;
  /** Speak one fixed line through the guard, and tell the model it was said. */
  speakLine(callId: CallId, line: string): AsyncIterable<AgentEvent>;
};

export function createAgentDriver(options: AgentDriverOptions): ClaudeAgentDriver {
  const { calls, press, guardSentence, checkCallerLine, model, pharmacyName, emit = () => {}, maxSteps = MAX_STEPS } = options;
  const state = new Map<CallId, CallState>();

  function track(callId: CallId, opts: DriverStartOpts) {
    state.set(callId, {
      direction: opts.direction,
      rxId: opts.rxId,
      patientName: opts.patientName,
      messages: [],
      callNote: callNote(callId, opts),
      notes: [],
      askedSideEffects: new Set(),
      ended: false,
    });
  }

  /** Every word the agent says passes here, and only the guard's `speak` comes out. */
  async function* speak(callId: CallId, sentence: string): AsyncIterable<AgentEvent> {
    const guarded = await guardSentence(callId, sentence);
    if (guarded.blocked) {
      state.get(callId)?.notes.push(`Instead of "${guarded.original}", the caller heard "${guarded.speak}".`);
      yield { type: "blocked_line", rule: guarded.rule, original: guarded.original, replacement: guarded.speak };
    }
    emit({ type: "line", callId, who: "agent", text: guarded.speak });
    yield { type: "line", text: guarded.speak };
  }

  /** A press the driver makes itself, for the fixed parts of the call. Same buttons, same lock. */
  async function* pressFixed<B extends ButtonName>(callId: CallId, button: B, input: ButtonInputs[B]): AsyncGenerator<AgentEvent, ButtonResult<B>> {
    const result = await press(callId, button, input);
    yield { type: "press", button, input, result };
    return result;
  }

  function pushUser(call: CallState, content: MessageParam["content"]) {
    call.messages.push({ role: "user", content } as MessageParam);
    if (call.notes.length) {
      call.messages.push({ role: "system", content: `Phone system: ${call.notes.join(" ")}` } as MessageParam);
      call.notes = [];
    }
  }

  /** A fixed line the driver said goes into the history as the agent's own words. */
  function pushSaid(call: CallState, line: string) {
    if (call.messages.length === 0) call.callNote += `\nYou have already said to the caller: "${line}"`;
    else call.messages.push({ role: "assistant", content: line });
  }

  async function* pressAll(callId: CallId, turn: ModelTurn, refilled: RxId[]): AsyncGenerator<AgentEvent, ToolResult[]> {
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
      const rxId = (block.input as { rx_id?: unknown })?.rx_id;
      if (block.name === "request_refill" && result.ok && typeof rxId === "string") {
        if (REFILL_GOING_AHEAD.has((result.output as { state: string }).state)) refilled.push(rxId);
      }
    }
    return results;
  }

  /**
   * SPEC Part 2, inbound step 8: after a refill, one question naming the side
   * effects the label lists, quoted. The label comes from read_label, so the
   * question is built from the record and the press is in it.
   */
  async function* askSideEffects(callId: CallId, call: CallState, refilled: RxId[]): AsyncIterable<AgentEvent> {
    const rxId = refilled.find((id) => !call.askedSideEffects.has(id));
    if (!rxId) return;
    call.askedSideEffects.add(rxId);
    const label = yield* pressFixed(callId, "read_label", { rx_id: rxId });
    const question = sideEffectQuestion(label.ok ? label.output.label_text : "");
    yield* speak(callId, question);
    pushSaid(call, question);
    call.awaitingSideEffect = rxId;
  }

  /** Hand the call to a pharmacist, through the escalate button like any other action. */
  async function* handOver(callId: CallId, reason: string): AsyncIterable<AgentEvent> {
    yield* pressFixed(callId, "escalate", { reason });
    yield* speak(callId, HANDOVER_LINE);
  }

  return {
    async startCall(opts) {
      const callId = await calls.startCall(opts);
      track(callId, opts);
      return callId;
    },

    joinCall(callId, opts) {
      if (!state.has(callId)) track(callId, opts);
    },

    async *opening(callId) {
      const call = state.get(callId);
      if (!call || call.ended) return;
      if (call.direction === "inbound") {
        const greeting = inboundGreeting(pharmacyName);
        yield* speak(callId, greeting);
        pushSaid(call, greeting);
        return;
      }
      // Outbound: the opener says who we are and who we're calling for, nothing else,
      // then the code goes to the phone on file (SPEC Part 2, outbound step 2).
      const opener = outboundOpener(pharmacyName, call.patientName ?? "the patient");
      yield* speak(callId, opener);
      pushSaid(call, opener);
      const sent = yield* pressFixed(callId, "send_code", { lookup_id: outboundLookupId(callId) });
      if (sent.ok) call.callNote += "\nThe code has been sent to the phone on file. Ask them to read it back.";
    },

    async *speakLine(callId, line) {
      const call = state.get(callId);
      if (!call || call.ended) return;
      yield* speak(callId, line);
      pushSaid(call, line);
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

      if (call.awaitingSideEffect) {
        call.notes.push(sideEffectNote(call.awaitingSideEffect));
        call.awaitingSideEffect = undefined;
      }
      pushUser(call, text);
      const system = `${systemPrompt({ pharmacyName, direction: call.direction })}\n\n${call.callNote}`.trim();
      const refilled: RxId[] = [];

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
        if (turn.stop_reason !== "tool_use") {
          yield* askSideEffects(callId, call, refilled);
          return;
        }

        const results = yield* pressAll(callId, turn, refilled);
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

/** How the model should treat the caller's answer to the side-effect question. */
function sideEffectNote(rxId: RxId): string {
  return [
    `The caller is answering the side-effect question about rx_id ${rxId}.`,
    `If they mention anything at all, press note_for_pharmacist with kind side_effect, rx_id ${rxId}, and what they noticed and since when, in their own words.`,
    `Then say: "${SIDE_EFFECT_PASSED_ON}" If they noticed nothing, carry on.`,
  ].join(" ");
}

/** Ids the model needs to press on this call. Opaque ids only: no patient detail. */
function callNote(callId: CallId, opts: DriverStartOpts): string {
  if (opts.direction !== "outbound") return "";
  const lines = [`For this call, the lookup id is ${outboundLookupId(callId)}.`];
  if (opts.rxId) lines.push(`The prescription this call is about has rx_id ${opts.rxId}.`);
  return lines.join("\n");
}
