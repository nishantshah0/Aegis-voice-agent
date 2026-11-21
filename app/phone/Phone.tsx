"use client";

import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { listenToEvents } from "@/lib/events/client";
import type { ListenerMode } from "@/lib/voice/listener";
import { TURN_TARGET_MS, createPhoneTiming } from "@/lib/voice/timing";
import { phoneApi } from "./api";
import { RULE_LABEL, initialPhone, phoneReducer, type PhoneState, type TranscriptItem } from "./state";
import { useVoice } from "./useVoice";

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
    void run(() => phoneApi.say(state.callId!, text));
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
  });

  useEffect(() => listenToEvents((event) => dispatch({ type: "event", event })), []);

  // The code text may hold only "a code was sent": then the phone asks for its own code.
  useEffect(() => {
    if (!state.callId || !state.message || state.code) return;
    let live = true;
    phoneApi.code(state.callId).then((r) => {
      if (live && r.ok && r.value.code) dispatch({ type: "code", code: r.value.code });
    });
    return () => {
      live = false;
    };
  }, [state.callId, state.message, state.code]);

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
      return phoneApi.answer(callId);
    });

  const dial = () =>
    run(async () => {
      dispatch({ type: "dial" });
      const started = await phoneApi.dial();
      if (!started.ok) return started;
      dispatch({ type: "connected", callId: started.value.callId });
      return phoneApi.answer(started.value.callId);
    });

  const hangUp = () =>
    run(async () => {
      const callId = state.callId;
      dispatch({ type: "hung_up" });
      return callId ? phoneApi.end(callId) : { ok: true };
    });

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !state.callId) return;
    setDraft("");
    say(text);
  }

  return (
    <div className="mx-auto flex h-[44rem] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border-8 border-neutral-900 bg-white shadow-xl dark:bg-neutral-950">
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
            />
            <form onSubmit={send} className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
              <label htmlFor="say" className="sr-only">
                What you say
              </label>
              <input
                id="say"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type what you'd say…"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                Send
              </button>
            </form>
            <button type="button" onClick={hangUp} className="mx-auto mb-4 rounded-full bg-red-600 px-6 py-2 text-sm font-medium text-white">
              Hang up
            </button>
          </>
        )}
      </div>
      <TurnTime medianMs={medianMs} />
      {state.problem && (
        <p role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
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
};

export function VoiceBar({ on, mode, hearing, speaking, onToggle, onMode, onHoldDown, onHoldUp }: VoiceBarProps) {
  return (
    <div className="border-t border-neutral-200 px-3 pt-2 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-pressed={on} onClick={onToggle} className={`rounded-full px-3 py-1 ${on ? "bg-green-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
          {on ? "Voice on" : "Use voice"}
        </button>
        {on && (
          <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={mode === "hold"} onChange={(e) => onMode(e.target.checked ? "hold" : "open")} />
            Hold to talk
          </label>
        )}
      </div>
      {on && (
        <p aria-live="polite" className="mt-1 min-h-5 text-xs text-neutral-500">
          {speaking ? "Pharmacy speaking…" : hearing ? `Hearing: ${hearing}` : mode === "hold" ? "Hold the button and talk." : "Listening…"}
        </p>
      )}
      {on && mode === "hold" && (
        <button
          type="button"
          onPointerDown={onHoldDown}
          onPointerUp={onHoldUp}
          onPointerLeave={onHoldUp}
          disabled={speaking}
          className="mt-1 w-full select-none rounded-xl bg-blue-600 py-3 font-medium text-white disabled:opacity-40"
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
    <p data-testid="turn-time" className={`px-4 pb-2 text-center text-xs ${fast ? "text-green-700" : "text-amber-700"}`}>
      Median turn {(medianMs / 1000).toFixed(2)} s (target {(TURN_TARGET_MS / 1000).toFixed(1)} s)
    </p>
  );
}

function StatusBar({ state }: { state: PhoneState }) {
  const label = state.mode === "in_call" ? "On a call" : state.mode === "ringing" ? "Incoming call" : state.mode === "dialling" ? "Calling…" : "Phone";
  return (
    <div className="border-b border-neutral-200 px-5 pb-2 pt-4 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">{label}</p>
      {state.status && (
        <p data-testid="phone-status" aria-live="polite" className="mt-1 rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-900">
          {state.status}
        </p>
      )}
    </div>
  );
}

function CodeMessage({ message, code }: { message: string; code?: string }) {
  return (
    <div data-testid="phone-code" aria-live="polite" className="mx-3 mt-3 rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">
      <p className="text-xs font-medium text-neutral-500">Message · Pharmacy</p>
      <p className="mt-1">{message}</p>
      {code && !message.includes(code) && <p className="mt-1 font-mono text-2xl tracking-widest">{code}</p>}
    </div>
  );
}

function Ringing({ text, onAnswer, busy }: { text?: string; onAnswer: () => void; busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <p className="text-2xl font-semibold" aria-live="assertive">
        {text ?? "Incoming call"}
      </p>
      <button type="button" onClick={onAnswer} disabled={busy} className="h-20 w-20 animate-pulse rounded-full bg-green-600 text-base font-semibold text-white disabled:opacity-40">
        Answer
      </button>
    </div>
  );
}

function Idle({ ended, onDial, busy }: { ended: boolean; onDial: () => void; busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-neutral-500">{ended ? "Call ended." : "Waiting for the pharmacy to call."}</p>
      <button type="button" onClick={onDial} disabled={busy} className="rounded-full border border-neutral-300 px-5 py-2 text-sm dark:border-neutral-700">
        Call the pharmacy
      </button>
    </div>
  );
}

export function Transcript({ items }: { items: TranscriptItem[] }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [items.length]);
  return (
    <ol aria-live="polite" data-testid="phone-transcript" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
      {items.map((item, i) =>
        item.kind === "line" ? (
          <li
            key={i}
            className={
              item.who === "caller"
                ? "max-w-[80%] self-end rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-white"
                : "max-w-[80%] self-start rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2 dark:bg-neutral-800"
            }
          >
            {item.text}
          </li>
        ) : (
          <li key={i} className="max-w-[80%] self-start px-1 text-xs text-red-700 dark:text-red-400">
            <span className="line-through">{item.original}</span>
            <span className="ml-1 font-medium">Stopped by {RULE_LABEL[item.rule]}</span>
          </li>
        ),
      )}
      <li ref={end} aria-hidden />
    </ol>
  );
}
