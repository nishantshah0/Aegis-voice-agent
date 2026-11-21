"use client";

import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { StreamEvent } from "@/lib/contract";
import { listenToEvents } from "@/lib/events/client";
import type { ListenerMode } from "@/lib/voice/listener";
import { TURN_TARGET_MS, createPhoneTiming } from "@/lib/voice/timing";
import { phoneApi } from "./api";
import { RULE_LABEL, initialPhone, phoneListener, phoneReducer, type PhoneState, type TranscriptItem } from "./state";
import { scrollToEnd } from "./scroll";
import { useVoice } from "./useVoice";
import { Mark } from "@/components/ui";

// The patient's phone (task 1.4). Everything on screen comes from /api/events;
// the buttons only start things on the server.
export function Phone() {
  const [state, dispatch] = useReducer(phoneReducer, undefined, initialPhone);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [mode, setMode] = useState<ListenerMode>("open");
  const timing = useRef(createPhoneTiming());
  const [medianMs, setMedianMs] = useState<number | undefined>();
  const mark = (step: "agentLine" | "speechStarted") => {
    timing.current[step]();
    setMedianMs(timing.current.medianMs());
  };

  const say = (text: string) => {
    if (!state.callId) return;
    timing.current.callerStopped();
    void run(() => phoneApi.say(state.callId!, text, state.phoneToken));
  };

  // Turn timing: the first agent line after the caller stopped.
  const last = state.transcript.at(-1);
  const lastIsAgentLine = last?.kind === "line" && last.who === "agent";
  useEffect(() => {
    if (lastIsAgentLine) mark("agentLine");
  }, [state.transcript.length, lastIsAgentLine]);
  const voice = useVoice({
    on: voiceOn && state.mode === "in_call",
    mode,
    callId: state.callId,
    transcript: state.transcript,
    onTurn: say,
    onProblem: (text) => {
      setVoiceOn(false);
      dispatch({ type: "problem", text });
    },
    onSpeechStart: () => mark("speechStarted"),
    // A missing check-in route only means no prompt: never interrupt the call over it.
    onSilence: () => {
      if (state.callId) void phoneApi.checkIn(state.callId, state.phoneToken);
    },
  });

  // In a call, the phone listens on its own call's stream with its token: only that stream
  // carries the call's lines (Trail #19). Before that, the plain stream, for rings.
  const listener = phoneListener(state);
  const listenCall = listener?.callId;
  const listenToken = listener?.token;
  useEffect(() => {
    const onEvent = (event: StreamEvent) => dispatch({ type: "event", event });
    return listenCall && listenToken ? listenToEvents(onEvent, { callId: listenCall, token: listenToken }) : listenToEvents(onEvent);
  }, [listenCall, listenToken]);

  // The code text may hold only "a code was sent": then the phone asks for its own code.
  useEffect(() => {
    if (!state.callId || !state.message || state.code) return;
    let live = true;
    phoneApi.code(state.callId, state.phoneToken).then((r) => {
      if (live && r.ok && r.value.code) dispatch({ type: "code", code: r.value.code });
    });
    return () => {
      live = false;
    };
  }, [state.callId, state.phoneToken, state.message, state.code]);

  async function run(step: () => Promise<{ ok: boolean; problem?: string }>) {
    setBusy(true);
    const result = await step();
    if (!result.ok && result.problem) dispatch({ type: "problem", text: result.problem });
    setBusy(false);
  }

  const answer = () =>
    run(async () => {
      const callId = state.callId!;
      dispatch({ type: "connected", callId });
      const answered = await phoneApi.answer(callId);
      if (answered.ok) {
        dispatch({ type: "connected", callId, phoneToken: answered.value.phoneToken });
        // The opener and the code ran inside the answer request, before the call's stream connected.
        dispatch({ type: "opening", events: answered.value.events ?? [] });
      }
      return answered;
    });

  const dial = () =>
    run(async () => {
      dispatch({ type: "dial" });
      const started = await phoneApi.dial();
      if (!started.ok) return started;
      const { callId, phoneToken } = started.value;
      dispatch({ type: "connected", callId, phoneToken });
      // Plays the greeting, which comes back in the response (it runs before the call's stream connects).
      const answered = await phoneApi.answer(callId, phoneToken);
      if (answered.ok) dispatch({ type: "opening", events: answered.value.events ?? [] });
      return { ok: true };
    });

  const hangUp = () =>
    run(async () => {
      const callId = state.callId;
      dispatch({ type: "hung_up" });
      return callId ? phoneApi.end(callId, state.phoneToken) : { ok: true };
    });

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !state.callId) return;
    setDraft("");
    say(text);
  }

  return (
    <div className="theme-dark relative mx-auto flex h-[100dvh] w-full max-w-[24rem] flex-col overflow-hidden bg-canvas text-ink sm:h-[min(50rem,calc(100dvh-5rem))] sm:rounded-[3rem] sm:border sm:border-line-strong sm:shadow-[0_40px_100px_-40px_rgb(0_0_0/0.7),0_0_0_10px_#000]">
      <StatusBar state={state} />
      {state.message && state.mode === "in_call" && <CodeMessage message={state.message} code={state.code} />}
      <div className="flex min-h-0 flex-1 flex-col">
        {state.mode === "ringing" ? (
          <Ringing text={state.ringText} onAnswer={answer} busy={busy} />
        ) : state.mode === "idle" || state.mode === "ended" ? (
          <Idle ended={state.mode === "ended"} onDial={dial} busy={busy} />
        ) : (
          <>
            <Transcript items={state.transcript} />
            <VoiceBar
              on={voiceOn}
              mode={mode}
              hearing={voice.hearing}
              speaking={voice.speaking}
              onToggle={() => setVoiceOn((v) => !v)}
              onMode={setMode}
              onHoldDown={voice.holdDown}
              onHoldUp={voice.holdUp}
              onInterrupt={voice.interrupt}
            />
            <form onSubmit={send} className="flex items-center gap-2 px-4 pb-3 pt-2">
              <label htmlFor="say" className="sr-only">
                What you say
              </label>
              <input
                id="say"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type what you'd say…"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus-visible:outline-none"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="h-11 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-ink-inverse transition-opacity disabled:opacity-35">
                Send
              </button>
            </form>
            <div className="flex justify-center pb-6 pt-2">
              <button
                type="button"
                onClick={hangUp}
                className="flex cursor-pointer flex-col items-center gap-1.5 text-xs font-medium text-ink-2 transition-transform active:scale-95"
              >
                <span className="flex size-16 items-center justify-center rounded-full bg-[#ff3b30] text-white" aria-hidden>
                  <PhoneIcon className="size-7 rotate-[135deg]" />
                </span>
                Hang up
              </button>
            </div>
          </>
        )}
      </div>
      <TurnTime medianMs={medianMs} />
      {state.problem && (
        <p role="alert" className="bg-quick-soft px-4 py-2.5 text-center text-sm text-quick">
          {state.problem}
        </p>
      )}
    </div>
  );
}

type VoiceBarProps = {
  on: boolean;
  mode: ListenerMode;
  hearing: string;
  speaking: boolean;
  onToggle: () => void;
  onMode: (mode: ListenerMode) => void;
  onHoldDown: () => void;
  onHoldUp: () => void;
  onInterrupt?: () => void;
};

export function VoiceBar({ on, mode, hearing, speaking, onToggle, onMode, onHoldDown, onHoldUp, onInterrupt }: VoiceBarProps) {
  return (
    <div className="px-4 pt-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={on}
          onClick={onToggle}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 font-medium transition-colors ${on ? "bg-accent text-ink-inverse" : "border border-line-strong text-ink hover:border-ink-3"}`}
        >
          {on ? "Voice on" : "Use voice"}
        </button>
        {on && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" className="size-4 accent-[var(--rg-accent)]" checked={mode === "hold"} onChange={(e) => onMode(e.target.checked ? "hold" : "open")} />
            Hold to talk
          </label>
        )}
      </div>
      {on && (
        <p aria-live="polite" className="mt-2 min-h-5 text-xs text-ink-3">
          {speaking ? "Pharmacy speaking…" : hearing ? `Hearing: ${hearing}` : mode === "hold" ? "Hold the button and talk." : "Listening…"}
        </p>
      )}
      {on && speaking && onInterrupt && (
        <button type="button" onClick={onInterrupt} className="mt-2 w-full cursor-pointer rounded-2xl bg-quick py-4 text-base font-semibold text-ink-inverse">
          Tap to interrupt
        </button>
      )}
      {on && mode === "hold" && (
        <button
          type="button"
          onPointerDown={onHoldDown}
          onPointerUp={onHoldUp}
          onPointerLeave={onHoldUp}
          disabled={speaking}
          className="mt-2 w-full cursor-pointer select-none rounded-2xl bg-accent py-3.5 font-semibold text-ink-inverse active:scale-[0.99] disabled:opacity-40"
        >
          Hold to talk
        </button>
      )}
    </div>
  );
}

/** Median time from the caller stopping to the agent's first word (task 1.6). */
export function TurnTime({ medianMs }: { medianMs?: number }) {
  if (medianMs === undefined) return null;
  const fast = medianMs <= TURN_TARGET_MS;
  return (
    <p data-testid="turn-time" className={`mx-auto mb-3 w-fit rounded-full bg-[#f3f3ef] px-3 py-1 text-center font-mono text-[11px] ${fast ? "text-green-700" : "text-amber-700"}`}>
      Median turn {(medianMs / 1000).toFixed(2)} s (target {(TURN_TARGET_MS / 1000).toFixed(1)} s)
    </p>
  );
}

function StatusBar({ state }: { state: PhoneState }) {
  const label = state.mode === "in_call" ? "On a call" : state.mode === "ringing" ? "Incoming call" : state.mode === "dialling" ? "Calling…" : "Phone";
  return (
    <div className="px-5 pb-2 pt-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          {state.mode === "in_call" && <span className="size-2 rounded-full bg-accent" aria-hidden />}
          {label}
        </p>
        <Mark className="size-4 opacity-80" />
      </div>
      {state.status && (
        <p data-testid="phone-status" aria-live="polite" className="mt-3 rounded-2xl bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent">
          {state.status}
        </p>
      )}
    </div>
  );
}

function CodeMessage({ message, code }: { message: string; code?: string }) {
  return (
    <div data-testid="phone-code" aria-live="polite" className="mx-4 mt-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-card">
      <p className="text-xs font-medium text-ink-3">Message · Pharmacy</p>
      <p className="mt-1 text-ink">{message}</p>
      {code && !message.includes(code) && <p className="mt-1.5 font-mono text-3xl font-semibold tracking-[0.3em] text-ink">{code}</p>}
    </div>
  );
}

function Avatar({ ringing = false }: { ringing?: boolean }) {
  return (
    <span className={`flex size-24 items-center justify-center rounded-full bg-surface ${ringing ? "rg-ring" : ""}`} aria-hidden>
      <Mark className="size-12" />
    </span>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1l-2.22 2.2Z"
      />
    </svg>
  );
}

function Ringing({ text, onAnswer, busy }: { text?: string; onAnswer: () => void; busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-between px-6 pb-14 pt-16 text-center">
      <div className="flex flex-col items-center gap-6">
        <Avatar ringing />
        <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]" aria-live="assertive">
          {text ?? "Incoming call"}
        </p>
      </div>
      <button
        type="button"
        onClick={onAnswer}
        disabled={busy}
        className="flex cursor-pointer flex-col items-center gap-2 text-sm font-medium text-ink-2 transition-transform active:scale-95 disabled:opacity-40"
      >
        <span className="flex size-20 items-center justify-center rounded-full bg-[#30d158] text-white" aria-hidden>
          <PhoneIcon className="size-9" />
        </span>
        Answer
      </button>
    </div>
  );
}

function Idle({ ended, onDial, busy }: { ended: boolean; onDial: () => void; busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <Avatar />
      <p className="text-lg text-ink-2">{ended ? "Call ended." : "Waiting for the pharmacy to call."}</p>
      <button
        type="button"
        onClick={onDial}
        disabled={busy}
        className="h-11 cursor-pointer rounded-full border border-line-strong px-6 text-sm font-medium text-ink transition-colors hover:border-ink-3 disabled:opacity-40"
      >
        Call the pharmacy
      </button>
    </div>
  );
}

export function Transcript({ items }: { items: TranscriptItem[] }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    scrollToEnd(end.current);
  }, [items.length]);
  return (
    <ol aria-live="polite" data-testid="phone-transcript" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3 text-[15px] leading-snug">
      {items.map((item, i) =>
        item.kind === "line" ? (
          <li
            key={i}
            className={
              item.who === "caller"
                ? "max-w-[82%] self-end rounded-[1.25rem] rounded-br-md bg-accent px-3.5 py-2 text-ink-inverse"
                : "max-w-[82%] self-start rounded-[1.25rem] rounded-bl-md bg-sunken px-3.5 py-2 text-ink"
            }
          >
            {item.text}
          </li>
        ) : (
          <li key={i} className="max-w-[82%] self-start px-1 text-[13px] text-ink-3">
            <span className="line-through">{item.original}</span>
            <span className="mt-0.5 block font-medium text-stop">Stopped by {RULE_LABEL[item.rule]}</span>
          </li>
        ),
      )}
      <li ref={end} aria-hidden />
    </ol>
  );
}
