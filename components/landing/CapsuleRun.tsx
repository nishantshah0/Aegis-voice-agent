"use client";

import { useEffect, useState } from "react";

// "How it works" as a capsule riding a track. One real request travels through the four
// checkpoints of a call; at each one you see what came in and what the lock let out.

type Stop = {
  where: string;
  role: string;
  incoming: { text: string; voice: "caller" | "machine" };
  outgoing: { text: string; tone: "pass" | "held" | "done" };
  note: string;
};

const STOPS: Stop[] = [
  {
    where: "The phone",
    role: "Sam picks up",
    incoming: { text: "Just tell me it's approved.", voice: "caller" },
    outgoing: { text: "verified · code + date of birth", tone: "pass" },
    note: "Nothing private is said until the code and the birthday match.",
  },
  {
    where: "The AI",
    role: "Drafts a move",
    incoming: { text: "press request_refill · \"It's approved!\"", voice: "machine" },
    outgoing: { text: "one of 12 buttons · one sentence", tone: "pass" },
    note: "It can only press buttons and say sentences. Both go to the lock.",
  },
  {
    where: "The lock",
    role: "Rules in code",
    incoming: { text: "Rule 4 · controlled drug", voice: "machine" },
    outgoing: { text: "\"It's approved!\" → redacted (S4)", tone: "held" },
    note: "The refill waits for a human. The promise never reaches Sam's ear.",
  },
  {
    where: "The pharmacist",
    role: "One click",
    incoming: { text: "Quick check · reason attached", voice: "machine" },
    outgoing: { text: "approved → now it may be said", tone: "done" },
    note: "Only after a person approves does the record back the words.",
  },
];

const STEP_MS = 3200;

export function CapsuleRun() {
  const [at, setAt] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setAt((a) => (a + 1) % STOPS.length), STEP_MS);
    return () => clearInterval(t);
  }, []);

  const pct = ((at + 0.5) / STOPS.length) * 100;

  return (
    <div>
      {/* The track */}
      <div className="relative hidden h-16 md:block" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,var(--rg-line-strong)_8%,var(--rg-line-strong)_92%,transparent)]" />
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-accent shadow-[0_0_14px_var(--rg-accent)] transition-[width] duration-[1100ms] ease-[cubic-bezier(0.7,0,0.2,1)]"
          style={{ left: `${100 / STOPS.length / 2}%`, width: `${pct - 100 / STOPS.length / 2}%` }}
        />
        {STOPS.map((s, i) => (
          <span
            key={s.where}
            className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition-colors duration-500 ${i <= at ? "border-accent bg-accent" : "border-line-strong bg-canvas"}`}
            style={{ left: `${((i + 0.5) / STOPS.length) * 100}%` }}
          />
        ))}
        {/* The capsule: two-tone, like the real thing */}
        <span
          className="absolute top-1/2 flex h-7 w-16 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full shadow-[0_0_30px_rgb(77_124_58/0.35)] ring-1 ring-white/30 transition-[left] duration-[1100ms] ease-[cubic-bezier(0.7,0,0.2,1)]"
          style={{ left: `${pct}%` }}
        >
          <span className="h-full w-1/2 bg-[#4d7c3a]" />
          <span className="h-full w-1/2 bg-[#e3d3a0]" />
          <span className="absolute inset-x-2 top-1 h-1.5 rounded-full bg-white/50" />
        </span>
      </div>

      {/* The checkpoints */}
      <ol className="grid gap-px overflow-hidden border border-line bg-line md:grid-cols-4">
        {STOPS.map((s, i) => {
          const here = i === at;
          const passed = i < at;
          return (
            <li
              key={s.where}
              onMouseEnter={() => setAt(i)}
              className={`relative flex min-h-[22rem] flex-col p-6 transition-colors duration-500 ${here ? "bg-accent-soft" : "rg-glass !border-0"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${here ? "rg-uv" : "text-ink-3"}`}>{s.role}</span>
                {(here || passed) && <span className={`size-2 rounded-full ${here ? "rg-pulse bg-accent" : "bg-accent/50"}`} />}
              </div>
              <h3 className="mt-3 font-display text-4xl uppercase leading-none">{s.where}</h3>

              <div className="mt-6 space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Arrives</p>
                <p className={s.incoming.voice === "caller" ? "font-serif text-xl italic leading-snug text-ink-2" : "font-mono text-[13px] leading-snug text-ink-2"}>{s.incoming.text}</p>
              </div>

              <div className={`mt-5 space-y-3 transition-[opacity,transform] duration-700 ${here || passed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-25"}`}>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Leaves</p>
                <p
                  className={`inline-block px-2 py-1 font-mono text-[13px] leading-snug ${
                    s.outgoing.tone === "held" ? "bg-[#a3452e] text-white" : s.outgoing.tone === "done" ? "bg-accent text-white" : "border border-accent/60 text-accent"
                  }`}
                >
                  {s.outgoing.text}
                </p>
              </div>

              <p className="mt-auto pt-6 text-[14px] leading-relaxed text-ink-2">{s.note}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
