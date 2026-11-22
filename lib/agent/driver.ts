import { calendarIntent, chooseCalendarOffer } from "./appointments";
import { collectIdentity, GREETING_ONLY, LIMITED_MENU, PHONE_MENU, readCode, type LocalIdentity } from "./limited-service";
import { APPOINTMENT_CONFIRMATION_QUESTION, confirmsBooking } from "@/lib/contract/appointment-consent";
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
  STILL_THERE,
  inboundGreeting,
  outboundOpener,
  pickLine,
  sideEffectQuestion,
  sideEffectQuestionBeforeRefill,
} from "./lines";
import type { AgentModel, ModelTurn, PressForModel } from "./model";
import { factQuestion, newFactContext } from "./fact-questions";
import { STAY_ON_TASK_NOTE, asksForAPersona } from "./persona";
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
  patientPhone?: boolean;
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
  /** 1.x: picks each call's voice and the wording of its handover. Tests pass a fixed one. */
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
  /** 1.x: the model was warmed with the system prompt, so it can't take more call-note text. */
  warmed?: boolean;
  /** Prescriptions refilled this call whose side-effect question has been asked. */
  askedSideEffects: Set<RxId>;
  /** Set right after the side-effect question, so the caller's answer is read as one. */
  awaitingSideEffect?: RxId;
  /** Caller lines still read as side-effect answers: the answer, then at most one follow-up. */
  sideEffectLinesLeft?: number;
  /** 1.x: check_code verified this call. */
  verified?: boolean;
  /** 1.x: whether each prescription can be refilled today, from check_prescription on this call. */
  refillable: Map<RxId, boolean>;
  /** 1.x: each prescription's label text, from read_label on this call, so the question needs no second press. */
  labels: Map<RxId, string>;
  /** 1.x: prescriptions with a side-effect note this call ("*" for a note naming none). */
  sideEffectNoted: Set<RxId | "*">;
  /**
   * 1.x: a refill the model asked for, not placed yet: the side-effect question comes first,
   * and the driver places it, through the lock, when the caller answers.
   */
  heldRefill?: { rxId: RxId; input: unknown };
  facts: ReturnType<typeof newFactContext>;
  appointmentSlots: Map<string, string>;
  choosingAppointment?: boolean;
  checkedIn?: boolean;
  limited?: LocalIdentity;
  pendingAppointment?: { input: ButtonInputs["note_for_pharmacist"]; offer: string; asked: boolean };
  /** 1.x: what the caller heard from the agent on the current caller line. */
  turnSaid: string[];
  /** One entry per caller line: when it arrived, first model text, first guarded sentence. */
  timings: ServerTurnTiming[];
  /** 1.x: this call's voice and its wording of the fixed handover line. */
  style: CallStyle;
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
      refillable: new Map(),
      facts: newFactContext(),
      appointmentSlots: new Map(),
      labels: new Map(),
      sideEffectNoted: new Set(),
      turnSaid: [],
      timings: [],
      style: pickStyle(random),
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
    state.get(callId)?.turnSaid.push(guarded.speak);
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
    // Once warmed, the system prompt is fixed, so the line goes into the history instead.
    if (call.messages.length === 0 && !call.warmed) call.callNote += `\nYou have already said to the caller: "${line}"`;
    else call.messages.push({ role: "assistant", content: line });
  }

  /** The system prompt for this call: the same on every turn, and the one a warmed model started with. */
  function systemFor(call: CallState): string {
    return `${systemPrompt({ pharmacyName, direction: call.direction, style: call.style })}\n\n${call.callNote}`.trim();
  }

  /** 1.x (audit fix 1): let the model start up while the opening plays, not on the first caller line. */
  function warmModel(callId: CallId, call: CallState) {
    if (!model.warm || call.warmed) return;
    call.warmed = true;
    model.warm({ callId, system: systemFor(call), messages: [], tools: BUTTON_TOOLS });
  }

  /**
   * 1.x (audit fix 1): right after the code checks out, the driver checks the
   * prescriptions itself, through the same buttons and the same lock, so the model
   * can answer and read back in one step instead of pressing each in turn. Outbound:
   * the prescription the call is about, its cost and its label. Inbound: each of the patient's, up to
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
        // The strength is on the label, not in check_prescription (live run range-2 guessed one).
        ["read_label", { rx_id: rxId }],
      ] as const) {
        const r = await press(callId, button, input);
        learn(call, button, input, r);
        events.push({ type: "press", button, input, result: r });
        checked.push({ button, rx_id: rxId, ...forModel(r) });
      }
    }
    return { events, checked };
  }

  /** What the driver learns from a press: which prescriptions can be refilled, their labels, side-effect notes. */
  function learn(call: CallState | undefined, name: string, input: unknown, result: ButtonResult) {
    if (!call || !result.ok) return;
    if (name === "check_code" && "verified" in result.output && result.output.verified) {
      call.verified = true;
      call.facts.prescriptions = result.output.prescriptions;
    }
    const rxId = (input as { rx_id?: unknown })?.rx_id;
    if (name === "check_prescription" && typeof rxId === "string") call.refillable.set(rxId, (result.output as { refillable_today: boolean }).refillable_today);
    if (name === "order_status" && (input as ButtonInputs["order_status"]).include_appointments) {
      const { appointment_slots } = result.output as { appointment_slots?: { slot_id: string; availability_text: string }[] };
      call.appointmentSlots = new Map((appointment_slots ?? []).map((slot) => [slot.slot_id, slot.availability_text]));
      call.choosingAppointment = !!appointment_slots?.length;
    }
    if (name === "read_label" && typeof rxId === "string") call.labels.set(rxId, (result.output as { label_text: string }).label_text);
    if (name === "note_for_pharmacist" && (input as { kind?: unknown })?.kind === "side_effect") {
      call.sideEffectNoted.add(typeof rxId === "string" ? rxId : "*");
      // The side effect is recorded: later lines aren't side-effect answers any more.
      call.awaitingSideEffect = undefined;
    }
  }

  const noted = (call: CallState, rxId: RxId) => call.sideEffectNoted.has(rxId) || call.sideEffectNoted.has("*");

  /**
   * 1.x: hold a refill until the side-effect question is answered, when the call is verified,
   * check_prescription hasn't said it can't be refilled today, and no side effect is on record
   * for it yet. Before verification, or for a refill the rules would refuse, the press goes to
   * the lock as before, so the lock still decides and records every attempt.
   */
  function shouldHold(call: CallState | undefined, name: string, input: unknown): call is CallState {
    if (!call || name !== "request_refill") return false;
    const rxId = (input as { rx_id?: unknown })?.rx_id;
    if (!call.verified || typeof rxId !== "string" || call.refillable.get(rxId) === false) return false;
    return !call.askedSideEffects.has(rxId) && !noted(call, rxId) && (!call.heldRefill || call.heldRefill.rxId === rxId);
  }

  /** One button press for the model, through the lock. A name that isn't a button never reaches it. */
  async function pressOne(callId: CallId, name: string, input: unknown, refilled: RxId[]): Promise<{ events: AgentEvent[]; content: string; isError: boolean }> {
    if (!isButtonName(name)) return { events: [], content: JSON.stringify({ error: "no such button" }), isError: true };
    const call = state.get(callId);
    const note = input as ButtonInputs["note_for_pharmacist"] | null;
    if (call?.verified && name === "note_for_pharmacist" && note?.kind === "appointment") {
      const offer = call.appointmentSlots.get(note.slot_id ?? "");
      if (!offer) return { events: [], content: "List available consultation times with order_status and ask the caller which works.", isError: true };
      call.pendingAppointment = { input: note, offer, asked: false };
      return { events: [], content: "Awaiting patient confirmation. The phone system will read back the time and ask for confirmation. End this turn now.", isError: false };
    }
    if (shouldHold(call, name, input)) {
      call.heldRefill = { rxId: (input as { rx_id: RxId }).rx_id, input };
      return { events: [], content: JSON.stringify(HELD), isError: false };
    }
    const result: ButtonResult = await press(callId, name, input);
    const rxId = (input as { rx_id?: unknown })?.rx_id;
    learn(call, name, input, result);
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
    // Never ask about something the caller already told us (Nishant, after the live demo call).
    const rxId = refilled.find((id) => !call.askedSideEffects.has(id) && !noted(call, id));
    if (!rxId) return;
    call.askedSideEffects.add(rxId);
    const label = yield* pressFixed(callId, "read_label", { rx_id: rxId });
    const question = sideEffectQuestion(label.ok ? label.output.label_text : "");
    yield* speak(callId, question);
    pushSaid(call, question);
    call.awaitingSideEffect = rxId;
    call.sideEffectLinesLeft = 2;
  }

  /**
   * 1.x: the model asked for a refill and it is held. If a side effect is already on
   * record, place it now. Otherwise ask the side-effect question first: the caller's
   * answer places it (placeHeld).
   */
  async function* afterHeld(callId: CallId, call: CallState, refilled: RxId[]): AsyncIterable<AgentEvent> {
    const held = call.heldRefill;
    if (!held || call.askedSideEffects.has(held.rxId)) return;
    if (noted(call, held.rxId)) {
      const result = yield* placeHeld(callId, call, refilled);
      if (result) call.notes.push(refillPlacedNote(result));
      return;
    }
    call.askedSideEffects.add(held.rxId);
    // The model already asked it this turn (live run side-effects-first): one question, not two.
    if (!call.turnSaid.some((line) => /side[- ]?effects?/i.test(line))) {
      const label = call.labels.get(held.rxId) ?? (yield* labelFor(callId, held.rxId));
      const question = sideEffectQuestionBeforeRefill(label);
      yield* speak(callId, question);
      pushSaid(call, question);
    }
    call.awaitingSideEffect = held.rxId;
    call.sideEffectLinesLeft = 2;
  }

  async function* labelFor(callId: CallId, rxId: RxId): AsyncGenerator<AgentEvent, string> {
    const label = yield* pressFixed(callId, "read_label", { rx_id: rxId });
    return label.ok ? label.output.label_text : "";
  }

  /** Place the held refill through the lock, as the model asked for it. */
  async function* placeHeld(callId: CallId, call: CallState, refilled: RxId[]): AsyncGenerator<AgentEvent, ButtonResult<"request_refill"> | undefined> {
    const held = call.heldRefill;
    if (!held) return undefined;
    call.heldRefill = undefined;
    const result = yield* pressFixed(callId, "request_refill", held.input as ButtonInputs["request_refill"]);
    if (result.ok && REFILL_GOING_AHEAD.has(result.output.state)) refilled.push(held.rxId);
    return result;
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

  async function* limitedReply(callId: CallId, call: CallState, text: string): AsyncIterable<AgentEvent> {
    const identity = call.limited ??= {};
    if (/^(?:please )?(?:(?:get|give|connect|transfer) me (?:to )?(?:a |the )?|(?:i (?:want|need) (?:to (?:speak|talk) to )?)(?:a |the )?)?(?:pharmacist|human|person)(?: please)?[!. ]*$/i.test(text)) {
      yield* handOver(callId, "The caller asked for a pharmacist.");
      return;
    }
    if (call.verified) {
      yield* speakFixed(callId, LIMITED_MENU);
      return;
    }
    const code = readCode(text);
    if (identity.lookupId && code) {
      const input = { lookup_id: identity.lookupId, code };
      const r = yield* pressFixed(callId, "check_code", input);
      learn(call, "check_code", input, r);
      if (call.verified) {
        yield* speakFixed(callId, "Thank you. What would you like to know about your fill history or insurance price?");
      } else {
        yield* speakFixed(callId, r.ok && "locked_until" in r.output ? "Verification is locked. Please call back later." : "I couldn't verify that code. Please check the message on your phone.");
      }
      return;
    }
    if ((call.direction === "inbound" && /\b(?:refill|record|history|price|cost|insurance|prescription|rx|sim)\b|\d{4}-\d{2}-\d{2}/i.test(text)) || identity.rx_number || identity.dob) {
      const lookup = collectIdentity(identity, text);
      if (lookup) {
        const r = yield* pressFixed(callId, "lookup_patient", lookup);
        if (r.ok) {
          identity.lookupId = r.output.lookup_id;
          delete identity.dob;
          delete identity.name;
          delete identity.rx_number;
          yield* speakFixed(callId, "If those details match, I've sent a code to the phone on file.");
          return;
        }
      }
      yield* speakFixed(callId, "For a record lookup, give your full name, date of birth as year-month-day, and the prescription number on the bottle.");
      return;
    }
    yield* speakFixed(callId, LIMITED_MENU);
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
        warmModel(callId, call);
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
      warmModel(callId, call);
    },

    speakLine: speakFixed,

    async *checkIn(callId) {
      const call = state.get(callId);
      if (!call || call.ended || call.checkedIn) return;
      call.checkedIn = true;
      yield* speakFixed(callId, STILL_THERE);
    },

    async *callerSays(callId, text) {
      const call = state.get(callId);
      if (!call || call.ended) {
        yield { type: "ended" };
        return;
      }
      emit({ type: "line", callId, who: "caller", text });
      call.turnSaid = [];
      call.checkedIn = false;
      const timing: ServerTurnTiming = { receivedAt: now() };
      call.timings.push(timing);

      const safety = await checkCallerLine(callId, text);
      if (safety.action !== "continue") {
        // The safety check has already queued this line for a pharmacist, so it isn't a side-effect answer,
        // and the next line isn't either. A held refill isn't placed: a pharmacist looks at the call first.
        call.awaitingSideEffect = undefined;
        call.heldRefill = undefined;
        call.pendingAppointment = undefined;
        yield { type: "safety", result: safety };
        pushUser(call, text);
        call.messages.push({ role: "assistant", content: safety.script });
        yield* speak(callId, safety.script);
        return;
      }

      if (options.patientPhone && call.direction === "inbound" && !call.awaitingSideEffect && !call.pendingAppointment && GREETING_ONLY.test(text.trim())) {
        pushUser(call, text);
        yield* speakFixed(callId, PHONE_MENU);
        return;
      }
      const appointment = call.pendingAppointment;
      if (appointment?.asked) {
        call.pendingAppointment = undefined;
        if (confirmsBooking(text)) {
          pushUser(call, text);
          const result = yield* pressFixed(callId, "note_for_pharmacist", appointment.input);
          call.choosingAppointment = false;
          const confirmation = result.ok && "confirmation_text" in result.output && typeof result.output.confirmation_text === "string"
            ? result.output.confirmation_text : "I couldn't book that time.";
          yield* speakFixed(callId, confirmation);
          return;
        }
        call.notes.push("That appointment was not booked. Follow the caller's latest request. If they want to book, select an available slot and confirm again.");
      }

      if (call.verified && call.direction === "inbound" && !call.awaitingSideEffect && !call.heldRefill) {
        const intent = calendarIntent(text, !!call.choosingAppointment || !!appointment);
        call.choosingAppointment = false;
        if (intent) {
          pushUser(call, text);
          if (intent === "decline" || intent === "other-person") {
            yield* speakFixed(callId, intent === "decline" ? "Okay, I'll leave it there." : "I can only help with your own appointments.");
            return;
          }
          const status = yield* pressFixed(callId, "order_status", { include_appointments: true });
          if (!status.ok) {
            yield* speakFixed(callId, "I couldn't retrieve the pharmacist's calendar.");
            return;
          }
          const slots = status.output.appointment_slots ?? [];
          const bookings = status.output.appointments ?? [];
          if (intent === "status" || intent === "manage" || bookings.length) {
            for (const booked of bookings) yield* speakFixed(callId, booked.confirmation_text);
            if (!bookings.length) yield* speakFixed(callId, "I don't see an upcoming consultation on your record.");
            if (intent === "manage") yield* speakFixed(callId, "A pharmacist can help change or cancel an existing time.");
            return;
          }
          if (!slots.length) {
            yield* speakFixed(callId, "I don't see any open consultation times.");
            return;
          }
          call.choosingAppointment = true;
          const selection = chooseCalendarOffer(text, slots);
          if (!selection) {
            for (const slot of slots) yield* speakFixed(callId, slot.availability_text);
            yield* speakFixed(callId, "Which of those times would you like?");
            return;
          }
          yield* speakFixed(callId, selection.availability_text);
          if (call.turnSaid.at(-1) === selection.availability_text) {
            yield* speakFixed(callId, APPOINTMENT_CONFIRMATION_QUESTION);
            if (call.turnSaid.at(-1) === APPOINTMENT_CONFIRMATION_QUESTION) {
              call.pendingAppointment = {
                input: { kind: "appointment", slot_id: selection.slot_id },
                offer: selection.availability_text,
                asked: true,
              };
            }
          }
          return;
        }
      }
      if (call.heldRefill && changesRefill(text)) {
        call.heldRefill = undefined;
        if (call.awaitingSideEffect) call.askedSideEffects.delete(call.awaitingSideEffect);
        call.awaitingSideEffect = undefined;
        call.notes.push("The pending refill was discarded. Confirm the caller's revised request, supply and matching quote before placing anything.");
      }
      const refilled: RxId[] = [];
      if (call.verified && !call.awaitingSideEffect && !call.heldRefill) {
        const facts = factQuestion(call.facts, text, call.rxId);
        if (facts) {
          pushUser(call, text);
          if (facts.line !== undefined) {
            yield* speakFixed(callId, facts.line);
          } else {
            if (facts.history) {
              const r = yield* pressFixed(callId, "check_prescription", { rx_id: facts.rxId, include_other_names: false });
              yield* speakFixed(callId, r.ok ? r.output.history_readback : "I couldn't retrieve that fill history.");
            }
            if (facts.coverage) {
              const r = yield* pressFixed(callId, "check_coverage", { rx_id: facts.rxId, ...(facts.days ? { days_supply: facts.days } : {}) });
              yield* speakFixed(callId, r.ok ? r.output.coverage_readback : "I couldn't retrieve that insurance quote.");
            }
          }
          return;
        }
      }
      if (call.awaitingSideEffect && (call.sideEffectLinesLeft ?? 0) > 0) {
        const followUp = call.sideEffectLinesLeft === 1;
        // The caller is answering the question asked before the refill: place it now, so a
        // side effect they mention goes onto it (the note moves it to Review).
        const placed = call.heldRefill?.rxId === call.awaitingSideEffect ? yield* placeHeld(callId, call, refilled) : undefined;
        if (placed) call.notes.push(refillPlacedNote(placed));
        call.notes.push(followUp ? sideEffectFollowUpNote(call.awaitingSideEffect) : sideEffectNote(call.awaitingSideEffect));
        call.sideEffectLinesLeft = (call.sideEffectLinesLeft ?? 1) - 1;
        if (call.sideEffectLinesLeft === 0) call.awaitingSideEffect = undefined;
      }
      // 1.x: a persona or off-task request gets a reminder on that line (it decides nothing).
      if (asksForAPersona(text)) call.notes.push(STAY_ON_TASK_NOTE);
      pushUser(call, text);
      if (call.limited) {
        yield* limitedReply(callId, call, text);
        return;
      }
      const system = systemFor(call);

      for (let step = 0; step < maxSteps; step++) {
        const splitter = createSentenceSplitter();
        let turn: ModelTurn | undefined;
        // Presses made by a model that runs its own tool steps (the Agent SDK), yielded in order.
        const pressed: AgentEvent[] = [];
        let attemptedPress = false;
        const pressForModel: PressForModel = async (name, input) => {
          attemptedPress = true;
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
          if (options.patientPhone && call.direction === "inbound" && !call.heldRefill && !call.awaitingSideEffect && !call.pendingAppointment && !refilled.length && step === 0 && !attemptedPress && !call.turnSaid.length) {
            model.endCall?.(callId);
            yield* limitedReply(callId, call, text);
            return;
          }
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
          const pending = call.pendingAppointment;
          if (pending && !pending.asked) {
            yield* speakFixed(callId, pending.offer);
            if (call.turnSaid.at(-1) === pending.offer) {
              yield* speakFixed(callId, APPOINTMENT_CONFIRMATION_QUESTION);
              pending.asked = call.turnSaid.at(-1) === APPOINTMENT_CONFIRMATION_QUESTION;
            }
            if (!pending.asked) call.pendingAppointment = undefined;
          }
          yield* afterHeld(callId, call, refilled);
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
      // The caller said yes and hung up before answering the side-effect question: place it anyway.
      if (call?.heldRefill) for await (const event of placeHeld(callId, call, [])) void event;
      if (call) call.ended = true;
      model.endCall?.(callId);
      await calls.endCall(callId);
      state.delete(callId);
    },
  };
}

function changesRefill(text: string): boolean {
  return /\b(cancel|hold off|wait|instead|not sure|maybe later|not yet|let me think|before (?:i|we) (?:decide|order)|how much|what.*cost|changed? my mind|never ?mind|different supply|(?:just|only|make it|switch to) (?:a |one |two |seven |fourteen |\d+[ -])?(?:days?|weeks?))\b|\b(?:don['’]t|do not) (?:order|refill|fill|place|want)\b/i.test(text);
}

/** What the model sees from a press: the button's own output, or its error, and the rule numbers. */
function forModel(result: ButtonResult): Record<string, unknown> {
  if (result.ok) return { ...(result.output as object), rule_ids: result.ruleIds };
  return { error: result.error, rule_ids: result.ruleIds };
}

/** 1.x: what the model sees when it asks for a refill that the driver holds until the side-effect question is answered. */
const HELD = {
  held: true,
  message:
    "Not placed yet. The phone system asks the side-effect question itself, right after you stop, and places this refill when the caller answers. Don't ask it yourself, and don't say the refill is in: at most a short acknowledgement such as \"Sure.\" If they already told you about a side effect on this call, press note_for_pharmacist with it first.",
};

/** 1.x: the held refill went through the lock when the caller answered. */
function refillPlacedNote(result: ButtonResult<"request_refill">): string {
  const outcome = result.ok && REFILL_GOING_AHEAD.has(result.output.state) ? "The refill request is now placed" : "Refill request result";
  return `${outcome}: ${JSON.stringify(forModel(result))}. Describe only the recorded outcome. Quote supply_text if provided.`;
}

/** How the model should treat the caller's answer to the side-effect question. */
function sideEffectNote(rxId: RxId): string {
  return [
    `The caller is answering the side-effect question about rx_id ${rxId}.`,
    "If they mention anything at all, find out when it started and whether it's mild or severe, asking once only for what they haven't already said.",
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
  'Then, if they already named a window, book it with set_delivery. If not, and nothing is booked, offer delivery or pickup in one short question: "Would you like delivery, or would you rather pick it up?"';

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
