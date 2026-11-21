"use client";

import { useEffect, useReducer } from "react";
import type { StreamEvent } from "@/lib/contract";
import { listenToEvents } from "@/lib/events/client";
import { describePass, initialStage, stageReducer, stopped, type Pass, type StageState } from "./state";

type Action = { event: StreamEvent; id: number };
const reduce = (s: StageState, a: Action) => stageReducer(s, a.event, a.id);

const TONE: Record<Pass["decision"], string> = {
  allowed: "border-emerald-400 bg-emerald-500/15 text-emerald-200",
  routed: "border-amber-400 bg-amber-500/15 text-amber-200",
  flagged: "border-amber-400 bg-amber-500/15 text-amber-200",
  refused: "border-rose-400 bg-rose-500/20 text-rose-200",
  blocked: "border-rose-400 bg-rose-500/20 text-rose-200",
};

// A pass slides in towards the gate; a stopped one shakes at the bar.
const MOTION: Record<Pass["decision"], string> = {
  allowed: "stage-through",
  routed: "stage-aside",
  flagged: "stage-aside",
  refused: "stage-stop",
  blocked: "stage-stop",
};

function Counter({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 px-8 py-5">
      <span className={`font-mono text-6xl font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="mt-2 text-sm uppercase tracking-widest text-neutral-400">{label}</span>
    </div>
  );
}

function PassRow({ pass, fresh }: { pass: Pass; fresh: boolean }) {
  return (
    <li className={`rounded-lg border px-4 py-2 ${TONE[pass.decision]} ${fresh ? MOTION[pass.decision] : ""}`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-lg">{describePass(pass)}</span>
        <span className="font-mono text-xs text-neutral-400">{pass.callId}</span>
      </div>
      {pass.gate === "speech" && (
        <p className="mt-1 text-sm">
          <span className="line-through opacity-60">{pass.original}</span>
          <span className="mx-2">→</span>
          <span>{pass.replacement}</span>
        </p>
      )}
    </li>
  );
}

export function StageView() {
  const [state, dispatch] = useReducer(reduce, undefined, initialStage);
  useEffect(() => listenToEvents((event, id) => dispatch({ event, id })), []);

  const caught = state.score?.caught ?? stopped(state);
  const broken = state.score?.broken ?? 0;
  const newest = state.passes[0]?.id;

  return (
    <main className="min-h-screen bg-neutral-950 p-10 text-neutral-100">
      <style>{`
        @keyframes stage-through { from { transform: translateX(-40px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes stage-aside { 0% { transform: translateX(-40px); opacity: 0 } 60% { transform: translateX(8px) } 100% { transform: none; opacity: 1 } }
        @keyframes stage-stop { 0% { transform: translateX(-40px); opacity: 0 } 50% { transform: none; opacity: 1 } 65% { transform: translateX(-10px) } 80% { transform: translateX(6px) } 100% { transform: none } }
        .stage-through { animation: stage-through 300ms ease-out }
        .stage-aside { animation: stage-aside 450ms ease-out }
        .stage-stop { animation: stage-stop 550ms ease-out }
        @media (prefers-reduced-motion: reduce) { .stage-through, .stage-aside, .stage-stop { animation: none } }
      `}</style>

      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Refill Guard · the lock</h1>
        <span className="font-mono text-sm text-neutral-400">{state.now ? new Date(state.now).toLocaleString() : "live"}</span>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4" aria-live="polite">
        <Counter label="Caught" value={caught} tone="text-rose-300" />
        <Counter label="Rules broken" value={broken} tone={broken === 0 ? "text-emerald-300" : "text-rose-500"} />
        <Counter label="To a pharmacist" value={state.counts.routed + state.counts.flagged} tone="text-amber-300" />
        <Counter label="Allowed" value={state.counts.allowed} tone="text-emerald-300" />
      </section>

      <section className="mt-6 flex gap-6 text-sm text-neutral-400">
        <span>Automatic {state.lanes.automatic}</span>
        <span>Quick check {state.lanes.quick_check}</span>
        <span>Review {state.lanes.review}</span>
        <span className="ml-auto">{state.events} events</span>
      </section>

      <section className="mt-8 grid grid-cols-[1fr_auto] gap-8">
        <div>
          <h2 className="mb-3 text-sm uppercase tracking-widest text-neutral-500">At the gate</h2>
          {state.passes.length === 0 ? (
            <p className="text-neutral-500">Waiting for the first press…</p>
          ) : (
            <ol className="space-y-2">
              {state.passes.slice(0, 14).map((p) => (
                <PassRow key={p.id} pass={p} fresh={p.id === newest} />
              ))}
            </ol>
          )}
        </div>
        <aside className="w-64 text-sm text-neutral-400">
          <h2 className="mb-3 uppercase tracking-widest text-neutral-500">What the AI can do</h2>
          <p>Only press 12 buttons, every one checked in code. Only speak through the speech guard (S1 to S4).</p>
          <p className="mt-3">Every number here comes from a live event, and every event is in the hash-chained record.</p>
        </aside>
      </section>
    </main>
  );
}
