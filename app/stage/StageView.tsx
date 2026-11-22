"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import type { StreamEvent } from "@/lib/contract";
import { listenToEvents } from "@/lib/events/client";
import { Logo, cn } from "@/components/ui";
import { triedToSay } from "./attacks";
import { QueuePanel, Transcript } from "./CallPanel";
import { GATE_CSS, Gate, HijackControls } from "./HijackPanel";
import { DECISION_WORDS, describePass, latestHijack, replayStage, stageReducer, stopped, type Pass, type StageState } from "./state";

type Action = { event: StreamEvent; id: number };
const reduce = (s: StageState, a: Action) => stageReducer(s, a.event, a.id);

const TONE: Record<Pass["decision"], string> = {
  allowed: "border-l-accent",
  routed: "border-l-quick",
  flagged: "border-l-quick",
  refused: "border-l-stop",
  blocked: "border-l-stop",
};

const PILL: Record<Pass["decision"], string> = {
  allowed: "bg-accent-soft text-accent",
  routed: "bg-quick-soft text-quick",
  flagged: "bg-quick-soft text-quick",
  refused: "bg-stop-soft text-stop",
  blocked: "bg-stop-soft text-stop",
};

// A pass slides in towards the gate; a stopped one shakes at the bar.
const MOTION: Record<Pass["decision"], string> = {
  allowed: "stage-through",
  routed: "stage-aside",
  flagged: "stage-aside",
  refused: "stage-stop",
  blocked: "stage-stop",
};

function Counter({ label, value, tone, hero = false }: { label: string; value: number | string; tone: string; hero?: boolean }) {
  return (
    <div className={cn("flex flex-col justify-between rounded-card border bg-surface p-6", hero ? "border-accent/40" : "border-line")}>
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <span className={cn("mt-6 text-6xl font-semibold tabular-nums tracking-[-0.04em] xl:text-7xl", tone)}>{value}</span>
    </div>
  );
}

function PassRow({ pass, fresh }: { pass: Pass; fresh: boolean }) {
  return (
    <li className={cn("rounded-xl border border-l-4 border-line bg-surface px-5 py-3.5", TONE[pass.decision], fresh && MOTION[pass.decision])}>
      <div className="flex items-center gap-4">
        <span className={cn("w-36 shrink-0 rounded-full px-2.5 py-1 text-center text-xs font-semibold", PILL[pass.decision])}>
          {DECISION_WORDS[pass.decision]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-lg text-ink">{describePass(pass)}</span>
        <span className="font-mono text-xs text-ink-3">{pass.callId}</span>
      </div>
      {pass.gate === "speech" && (
        <p className="mt-2 pl-40 text-base leading-snug">
          {pass.original ? (
            <span className="text-ink-3 line-through decoration-stop decoration-2">{pass.original}</span>
          ) : (
            <span className="italic text-ink-3">{triedToSay(pass.label, pass.original).text}</span>
          )}
          <span className="mx-2 text-ink-3">→</span>
          <span className="text-ink">{pass.replacement}</span>
        </p>
      )}
    </li>
  );
}

/**
 * The stage. On its own (/stage) it is the full-screen projector view. Inside the app,
 * `embedded` drops the page chrome and shows one part: the gate feed or the hijack.
 */
export function StageView({
  embedded,
  initial = [],
  lastCallId = null,
  signedIn = false,
}: { embedded?: "gate" | "attacks"; initial?: StreamEvent[]; lastCallId?: string | null; signedIn?: boolean } = {}) {
  const [state, dispatch] = useReducer(reduce, initial, (events) => replayStage(events, lastCallId));
  useEffect(() => listenToEvents((event, id) => dispatch({ event, id })), []);

  // Caught and Rules broken come only from a hijack batch's score events (Role 3), never
  // from counting refusals: an ordinary caller asking too early is refused too.
  const caught = state.score ? state.score.caught : "—";
  const broken = state.score ? state.score.broken : "—";
  const newest = state.passes[0]?.id;

  return (
    <Frame embedded={Boolean(embedded)}>
      <style>{`
        @keyframes stage-through { from { transform: translateX(-40px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes stage-aside { 0% { transform: translateX(-40px); opacity: 0 } 60% { transform: translateX(8px) } 100% { transform: none; opacity: 1 } }
        @keyframes stage-stop { 0% { transform: translateX(-40px); opacity: 0 } 50% { transform: none; opacity: 1 } 65% { transform: translateX(-10px) } 80% { transform: translateX(6px) } 100% { transform: none } }
        .stage-through { animation: stage-through 300ms ease-out }
        .stage-aside { animation: stage-aside 450ms ease-out }
        .stage-stop { animation: stage-stop 550ms ease-out }
        @media (prefers-reduced-motion: reduce) { .stage-through, .stage-aside, .stage-stop { animation: none } }
        ${GATE_CSS}
      `}</style>

      {!embedded && (
        <header className="flex items-center justify-between border-b border-line pb-6">
          <div className="flex items-center gap-4">
            <Logo size="lg" />
            <span className="h-6 w-px bg-line-strong" aria-hidden />
            <span className="text-lg text-ink-2">The lock, live</span>
          </div>
          <div className="flex items-center gap-4">
            {state.now && <span className="font-mono text-sm text-ink-3">{new Date(state.now).toLocaleString()}</span>}
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
              <span className="size-2 rounded-full bg-accent rg-ring" aria-hidden />
              Live
            </span>
          </div>
        </header>
      )}

      <section className={embedded ? "grid grid-cols-2 gap-4 md:grid-cols-5" : "mt-8 grid grid-cols-2 gap-4 md:grid-cols-5"} aria-live="polite">
        <Counter label="Rules broken" value={broken} hero tone={broken === 0 ? "text-accent" : broken === "—" ? "text-ink-3" : "text-stop"} />
        <Counter label="Attacks caught" value={caught} tone="text-ink" />
        <Counter label="Stopped at the gate" value={stopped(state)} tone="text-stop" />
        <Counter label="To a pharmacist" value={state.counts.routed + state.counts.flagged} tone="text-quick" />
        <Counter label="Allowed" value={state.counts.allowed} tone="text-ink" />
      </section>

      <section className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 text-base text-ink-2">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-auto" aria-hidden />
          Automatic <span className="font-semibold tabular-nums text-ink">{state.lanes.automatic}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-quick" aria-hidden />
          Quick check <span className="font-semibold tabular-nums text-ink">{state.lanes.quick_check}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-review" aria-hidden />
          Review <span className="font-semibold tabular-nums text-ink">{state.lanes.review}</span>
        </span>
        <span className="ml-auto font-mono text-sm text-ink-3">{state.events} events</span>
      </section>

      {typeof broken === "number" && broken > 0 && (
        <p role="alert" className="mt-5 rounded-card border-2 border-stop bg-stop-soft px-6 py-4 text-xl font-semibold text-stop">
          {broken} rule{broken === 1 ? " was" : "s were"} broken in this batch. This is a real result: stop the demo and check results/hijack.
        </p>
      )}

      {embedded !== "attacks" && (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-label="The call">
          <div aria-live="polite">
            <Transcript call={state.call} signedIn={signedIn} />
          </div>
          <QueuePanel queue={state.queue} />
        </section>
      )}

      {embedded !== "gate" && (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="The hijack">
          <HijackControls />
          <div aria-live="polite">
            <Gate pass={latestHijack(state)} />
          </div>
        </section>
      )}

      {embedded !== "attacks" && (
        <section className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_20rem]">
          <div>
            <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.08em] text-ink-3">At the gate</h2>
            {state.passes.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-card border border-dashed border-line-strong text-lg text-ink-3">
                Waiting for the next call…
              </div>
            ) : (
              <ol className="space-y-2">
                {state.passes.slice(0, 14).map((p) => (
                  <PassRow key={p.id} pass={p} fresh={p.id === newest} />
                ))}
              </ol>
            )}
          </div>
          <aside className="text-base leading-relaxed text-ink-2">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.08em] text-ink-3">What the AI can do</h2>
            <div className="rounded-card border border-line bg-surface p-6">
              <p>
                Press <span className="font-semibold text-ink">12 buttons</span>, every one checked in code.
              </p>
              <p className="mt-3">
                Speak only through the <span className="font-semibold text-ink">speech guard</span> (S1 to S4).
              </p>
              <p className="mt-5 border-t border-line pt-5 text-sm text-ink-3">
                Every number here comes from a live event, and every event is in the hash-chained record.
              </p>
            </div>
          </aside>
        </section>
      )}
    </Frame>
  );
}

function Frame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <div>{children}</div> : <main className="theme-dark min-h-screen bg-canvas px-10 py-8 text-ink xl:px-14">{children}</main>;
}
