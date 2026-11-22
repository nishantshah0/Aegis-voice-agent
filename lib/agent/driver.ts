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
import type { ServerTurnTiming } from "@/lib/voice/timing";
import { SEED } from "@/lib/seed";
import {
  HANDOVER_LINE,
  HANDOVER_LINES,
  HOLDING,
  SIDE_EFFECT_PASSED_ON,
  STILL_THERE_LINES,
  inboundGreeting,
  outboundOpener,
  pickLine,
  sideEffectQuestion,
} from "./lines";
import type { AgentModel, ModelTurn, PressForModel } from "./model";
import { pickStyle, systemPrompt, type CallStyle } from "./prompt";
import { createSentenceSplitter } from "./sentences";
import { BUTTON_TOOLS, isButtonName } from "./tools";
import { UsageCapError } from "./usage";

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
  /** Clock for turn timing (task 1.6), in ms. Tests pass a fake one. */
  now?: () => number;
  /** 1.x: picks each call's voice and the wording of its check-in and handover. Tests pass a fixed one. */
  random?: () => number;
  /** 1.x: the pharmacy's delivery windows (tier 0), listed in the call note so set_delivery has a slot id. */
  deliverySlots?: { id: string; label: string }[];
};

/** A delivery window as the call note lists it. */
type DeliverySlot = { id: string; label: string };

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
  /** Caller lines still read as side-effect answers: the answer, then at most one follow-up. */
  sideEffectLinesLeft?: number;
  /** One entry per caller line: when it arrived, first model text, first guarded sentence. */
  timings: ServerTurnTiming[];
  /** 1.x: this call's voice and its wording of the fixed check-in and handover lines. */
  style: CallStyle;
  stillThere: string;
  handover: string;
  ended: boolean;
};

export const MAX_STEPS = 8;
export const STUCK_REASON = "The agent could not finish the caller's request.";
export { HANDOVER_LINE };

/** 1.x: after verification, how many of the patient's prescriptions the driver checks itself. */
const PREFETCH_MAX = 3;

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
  /** After a long silence (task 1.8): the fixed "are you still there?" line, through the guard. */
  checkIn(callId: CallId): AsyncIterable<AgentEvent>;
  /** Turn timing for this call (task 1.6): one entry per caller line. */
  turnTimings(callId: CallId): ServerTurnTiming[];
};

export function createAgentDriver(options: AgentDriverOptions): ClaudeAgentDriver {
  const {
    calls,
    press,
    guardSentence,
    checkCallerLine,
    model,
    pharmacyName,
    emit = () => {},
    maxSteps = MAX_STEPS,
    now = () => performance.now(),
    random = Math.random,
    deliverySlots = SEED.slots.map((s) => ({ id: s.id, label: s.label })),
  } = options;
  const state = new Map<CallId, CallState>();

  function track(callId: CallId, opts: DriverStartOpts) {
    state.set(callId, {
      direction: opts.direction,
      rxId: opts.rxId,
      patientName: opts.patientName,
      messages: [],
      callNote: callNote(callId, opts, deliverySlots),
      notes: [],
      askedSideEffects: new Set(),
      timings: [],
      style: pickStyle(random),
      stillThere: pickLine(STILL_THERE_LINES, random),
      handover: pickLine(HANDOVER_LINES, random),
      ended: false,
    });
  }

  /** Every word the agent says passes here, and only the guard's `speak` comes out. */
  async function* speak(callId: CallId, sentence: string): AsyncIterable<AgentEvent> {
    const guarded = await guardSentence(callId, sentence);
    const turn = state.get(callId)?.timings.at(-1);
    if (turn && turn.firstGuardedMs === undefined) turn.firstGuardedMs = now() - turn.receivedAt;
    if (guarded.blocked) {
      // What to do with it, not just what happened: a bare report reads as "you
      // made a mistake", and a helpful model then apologises on the call for a
      // sentence the caller never heard (demo pass 14).
      state.get(callId)?.notes.push(
        `Instead of "${guarded.original}", the caller heard "${guarded.speak}". Carry on from what they heard. Do not mention the change or apologise for it, because to them nothing went wrong.`,
      );
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

  /**
   * 1.x (audit fix 1): right after the code checks out, the driver checks the
   * prescriptions itself, through the same buttons and the same lock, so the model
   * can answer and read back in one step instead of pressing each in turn. Outbound:
   * the prescription the call is about. Inbound: each of the patient's, up to
   * PREFETCH_MAX. The coverage figure is then in the record, so a read-back of it
   * passes S4 (audit fix 2).
   */
  async function prefetch(callId: CallId, result: ButtonResult): Promise<{ events: AgentEvent[]; checked: Record<string, unknown>[] }> {
    const events: AgentEvent[] = [];
    const checked: Record<string, unknown>[] = [];
    const output = result.ok ? (result.output as { verified?: boolean; prescriptions?: { rx_id: RxId }[] }) : undefined;
    if (!output?.verified) return { events, checked };
    const call = state.get(callId);
    const rxIds = call?.direction === "outbound" && call.rxId ? [call.rxId] : (output.prescriptions ?? []).map((p) => p.rx_id).slice(0, PREFETCH_MAX);
    for (const rxId of rxIds) {
      for (const [button, input] of [
        ["check_prescription", { rx_id: rxId, include_other_names: false }],
        ["check_coverage", { rx_id: rxId }],
      ] as const) {
        const r = await press(callId, button, input);
        events.push({ type: "press", button, input, result: r });
        checked.push({ button, rx_id: rxId, ...forModel(r) });
      }
    }
    return { events, checked };
  }

  /** One button press for the model, through the lock. A name that isn't a button never reaches it. */
  async function pressOne(callId: CallId, name: string, input: unknown, refilled: RxId[]): Promise<{ events: AgentEvent[]; content: string; isError: boolean }> {
    if (!isButtonName(name)) return { events: [], content: JSON.stringify({ error: "no such button" }), isError: true };
    const result: ButtonResult = await press(callId, name, input);
    const rxId = (input as { rx_id?: unknown })?.rx_id;
    if (name === "note_for_pharmacist" && result.ok && (input as { kind?: unknown })?.kind === "side_effect") {
      // The side effect is recorded: later lines aren't side-effect answers any more.
      const call = state.get(callId);
      if (call) call.awaitingSideEffect = undefined;
    }
    if (name === "request_refill" && result.ok && typeof rxId === "string") {
      if (REFILL_GOING_AHEAD.has((result.output as { state: string }).state)) refilled.push(rxId);
    }
    const events: AgentEvent[] = [{ type: "press", button: name, input, result }];
    const seen = forModel(result);
    if (name === "check_code") {
      const extra = await prefetch(callId, result);
      events.push(...extra.events);
      if (extra.checked.length) seen.already_checked = extra.checked;
    }
    return { events, content: JSON.stringify(seen), isError: !result.ok };
  }

  async function* pressAll(callId: CallId, turn: ModelTurn, refilled: RxId[]): AsyncGenerator<AgentEvent, ToolResult[]> {
    const results: ToolResult[] = [];
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const pressed = await pressOne(callId, block.name, block.input, refilled);
      yield* pressed.events;
      results.push({ type: "tool_result", tool_use_id: block.id, is_error: pressed.isError, content: pressed.content });
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
    call.sideEffectLinesLeft = 2;
  }

  /** One fixed line, through the guard, into the history as the agent's own words. */
  async function* speakFixed(callId: CallId, line: string): AsyncIterable<AgentEvent> {
    const call = state.get(callId);
    if (!call || call.ended) return;
    yield* speak(callId, line);
    pushSaid(call, line);
  }

  /** Hand the call to a pharmacist, through the escalate button like any other action. */
  async function* handOver(callId: CallId, reason: string): AsyncIterable<AgentEvent> {
    yield* pressFixed(callId, "escalate", { reason });
    yield* speak(callId, state.get(callId)?.handover ?? HANDOVER_LINE);
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
      if (sent.ok) {
        call.callNote +=
          "\nThe code has been sent to the phone on file. Ask them to read it back and to confirm their date of birth, then press check_code with both: the code, and the date of birth as dob.";
      }
    },

    speakLine: speakFixed,

    checkIn: (callId) => speakFixed(callId, state.get(callId)?.stillThere ?? STILL_THERE_LINES[0]),

    async *callerSays(callId, text) {
      const call = state.get(callId);
      if (!call || call.ended) {
        yield { type: "ended" };
        return;
      }
      emit({ type: "line", callId, who: "caller", text });
      const timing: ServerTurnTiming = { receivedAt: now() };
      call.timings.push(timing);

      const safety = await checkCallerLine(callId, text);
      if (safety.action !== "continue") {
        // The safety check has already queued this line for a pharmacist, so it isn't a side-effect answer,
        // and the next line isn't either.
        call.awaitingSideEffect = undefined;
        yield { type: "safety", result: safety };
        pushUser(call, text);
        call.messages.push({ role: "assistant", content: safety.script });
        yield* speak(callId, safety.script);
        return;
      }

      if (call.awaitingSideEffect && (call.sideEffectLinesLeft ?? 0) > 0) {
        const followUp = call.sideEffectLinesLeft === 1;
        call.notes.push(followUp ? sideEffectFollowUpNote(call.awaitingSideEffect) : sideEffectNote(call.awaitingSideEffect));
        call.sideEffectLinesLeft = (call.sideEffectLinesLeft ?? 1) - 1;
        if (call.sideEffectLinesLeft === 0) call.awaitingSideEffect = undefined;
      }
      pushUser(call, text);
      const system = `${systemPrompt({ pharmacyName, direction: call.direction, style: call.style })}\n\n${call.callNote}`.trim();
      const refilled: RxId[] = [];

      for (let step = 0; step < maxSteps; step++) {
        const splitter = createSentenceSplitter();
        let turn: ModelTurn | undefined;
        // Presses made by a model that runs its own tool steps (the Agent SDK), yielded in order.
        const pressed: AgentEvent[] = [];
        const pressForModel: PressForModel = async (name, input) => {
          const r = await pressOne(callId, name, input, refilled);
          pressed.push(...r.events);
          return { content: r.content, isError: r.isError };
        };
        try {
          for await (const event of model.turn({ callId, system, messages: call.messages, tools: BUTTON_TOOLS, press: pressForModel })) {
            if (pressed.length) {
              for (const sentence of splitter.flush()) yield* speak(callId, sentence);
              yield* pressed.splice(0);
            }
            if (event.type === "done") turn = event.turn;
            else if (timing.firstModelTextMs === undefined) timing.firstModelTextMs = now() - timing.receivedAt;
            if (event.type === "text") for (const sentence of splitter.push(event.text)) yield* speak(callId, sentence);
          }
        } catch (error) {
          // The model is unavailable (usage cap, SDK error, network): say so through the guard and get a person.
          for (const sentence of splitter.flush()) yield* speak(callId, sentence);
          yield* pressed.splice(0);
          yield* handOver(callId, error instanceof UsageCapError ? "The assistant reached its usage limit." : "The assistant could not continue this call.");
          return;
        }
        for (const sentence of splitter.flush()) yield* speak(callId, sentence);
        yield* pressed.splice(0);

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

    turnTimings(callId) {
      return (state.get(callId)?.timings ?? []).map((t) => ({ ...t }));
    },

    async endCall(callId) {
      const call = state.get(callId);
      if (call) call.ended = true;
      model.endCall?.(callId);
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
    "If they mention anything at all, find out when it started and whether it's mild or severe, asking once if they haven't said.",
    `Then press note_for_pharmacist with kind side_effect, rx_id ${rxId}: what they noticed, since when, and how bad, in their own words.`,
    `Then say: "${SIDE_EFFECT_PASSED_ON}" No advice: don't say what it might mean or what to do about it.`,
    "If they noticed nothing, carry on.",
    AFTER_SIDE_EFFECTS,
  ].join(" ");
}

/** The caller's answer to the one follow-up question. */
function sideEffectFollowUpNote(rxId: RxId): string {
  return [
    `The caller is answering your side-effect follow-up about rx_id ${rxId}.`,
    `If they mentioned a side effect, press note_for_pharmacist with kind side_effect, rx_id ${rxId}: what they noticed, since when, and how bad, in their own words, with anything they couldn't say left out.`,
    `Then say: "${SIDE_EFFECT_PASSED_ON}" No advice.`,
    AFTER_SIDE_EFFECTS,
  ].join(" ");
}

/** 1.x: proactive, not pushy. Once the side effects are dealt with, the next useful question. */
const AFTER_SIDE_EFFECTS =
  'Then, if it isn\'t settled yet, offer delivery or pickup in one short question: "Would you like delivery, or would you rather pick it up?"';

/**
 * Ids the model needs to press on this call. Opaque ids and the pharmacy's own
 * delivery windows (tier 0) only: no patient detail.
 */
function callNote(callId: CallId, opts: DriverStartOpts, slots: DeliverySlot[]): string {
  const lines: string[] = [];
  if (opts.direction === "outbound") {
    lines.push(`For this call, the lookup id is ${outboundLookupId(callId)}.`);
    if (opts.rxId) lines.push(`The prescription this call is about has rx_id ${opts.rxId}.`);
  }
  if (slots.length) {
    const listed = slots.map((s) => `${s.label} (slot_id ${s.id})`).join("; ");
    lines.push(`The pharmacy's delivery and pickup windows: ${listed}. For pickup, set_delivery takes address_id "pickup".`);
  }
  return lines.join("\n");
}
