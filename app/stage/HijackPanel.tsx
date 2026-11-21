"use client";

import { useState, type FormEvent } from "react";
import { Button, cn } from "@/components/ui";
import { exitOf, MAX_ATTACK_TEXT, ruleWords, STAGE_ATTACKS, triedToSay, type Exit } from "./attacks";
import { DECISION_WORDS, type Pass } from "./state";

// Demo step 4 (SPEC Part 8): the judge picks what a fully fooled AI tries. The panel only
// asks; the lock answers through press and blocked_line events, shown one at a time.

const EXIT_BORDER: Record<Exit, string> = { red: "border-stop", amber: "border-quick", green: "border-accent" };
const EXIT_TEXT: Record<Exit, string> = { red: "text-stop", amber: "text-quick", green: "text-accent" };
const EXIT_SOFT: Record<Exit, string> = { red: "bg-stop-soft", amber: "bg-quick-soft", green: "bg-accent-soft" };

async function post(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Can't reach the server";
  }
}

export function HijackControls() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, url: string, body: unknown, holdMs: number) {
    setError(null);
    setBusy(label);
    const problem = await post(url, body);
    if (problem) {
      setError(problem);
      setBusy(null);
      return;
    }
    setTimeout(() => setBusy((b) => (b === label ? null : b)), holdMs);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const attack = text.trim();
    if (attack) void run("text", "/stage/attack", { text: attack }, 8000);
  }

  return (
    <div className="rounded-card border border-stop/40 bg-surface p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Swap in a compromised AI</h2>
        <span className="text-sm text-ink-3">It does anything it&rsquo;s asked. You choose.</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {STAGE_ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(a.id, "/stage/attack", { card: a.id }, 8000)}
            className={cn(
              "cursor-pointer rounded-xl border border-line-strong bg-canvas px-5 py-4 text-left transition-[border-color,transform] duration-150 hover:border-stop active:scale-[0.98] disabled:cursor-default disabled:opacity-45",
              busy === a.id && "border-stop opacity-100",
            )}
          >
            <span className="block text-xl font-semibold text-ink">{a.title}</span>
            <span className="mt-1 block text-sm leading-snug text-ink-3">{a.tries}</span>
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-4 flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_ATTACK_TEXT}
          placeholder="Make it try…"
          aria-label="Make it try"
          className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-canvas px-5 text-lg text-ink placeholder:text-ink-3 focus:border-stop focus:outline-none"
        />
        <Button type="submit" size="lg" variant="deny" disabled={busy !== null || !text.trim()}>
          Try it
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-5">
        <span className="text-sm text-ink-3">{error ?? (busy === "batch" ? "Batch running: every attack card, about 10 seconds…" : busy ? "The fooled AI is pressing…" : "Or run every attack card for the counters.")}</span>
        <Button size="lg" variant="secondary" disabled={busy !== null} onClick={() => void run("batch", "/api/arena/hijack", undefined, 12000)}>
          Run batch
        </Button>
      </div>
    </div>
  );
}

function TriedLine({ pass }: { pass: Pass }) {
  const tried = triedToSay(pass.label, pass.original);
  return tried.hidden ? (
    <p className="text-2xl italic text-ink-2">{tried.text}.</p>
  ) : (
    <p className="text-ink-3 line-through decoration-stop decoration-[3px]">{tried.text}</p>
  );
}

export function Gate({ pass }: { pass: Pass | undefined }) {
  if (!pass) {
    return (
      <div className="flex h-full min-h-72 items-center justify-center rounded-card border border-dashed border-line-strong p-6 text-center text-xl text-ink-3">
        Pick an attack. Each thing the AI tries stops here first.
      </div>
    );
  }
  const exit = exitOf(pass.decision);
  return (
    <div className="flex h-full flex-col">
      <div key={pass.id} className={cn("gate-card flex-1 rounded-card border-2 bg-surface p-6", EXIT_BORDER[exit])}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium uppercase tracking-[0.08em] text-ink-3">{pass.gate === "speech" ? "The AI tried to say" : "The AI pressed"}</span>
          <span className={cn("gate-exit rounded-full px-4 py-1.5 text-lg font-semibold", EXIT_SOFT[exit], EXIT_TEXT[exit])}>{DECISION_WORDS[pass.decision]}</span>
        </div>
        {pass.gate === "speech" ? (
          <div className="mt-4 text-3xl leading-tight">
            <TriedLine pass={pass} />
            <p className="gate-rules mt-3 text-ink">{pass.replacement}</p>
          </div>
        ) : (
          <p className="mt-4 font-mono text-4xl font-semibold text-ink">{pass.label.replace(/_/g, " ")}</p>
        )}
        <ul className="gate-rules mt-6 flex flex-wrap gap-2">
          {pass.ruleIds.length === 0 ? (
            <li className="text-base text-ink-3">No rule in the way</li>
          ) : (
            pass.ruleIds.map((id) => (
              <li key={id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-base", EXIT_BORDER[exit])}>
                <span className={cn("font-mono font-semibold", EXIT_TEXT[exit])}>{id}</span>
                <span className="text-ink-2">{ruleWords(id)}</span>
              </li>
            ))
          )}
        </ul>
      </div>
      <p className="mt-4 text-center text-2xl font-medium text-ink">
        {exit === "green" ? "Allowed: nothing a rule guards." : exit === "amber" ? "The AI asked. A pharmacist decides." : "The AI asked. The rules said no."}
      </p>
    </div>
  );
}

export const GATE_CSS = `
  @keyframes gate-in { from { transform: translateX(-60px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes gate-light { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  .gate-card { animation: gate-in 400ms ease-out }
  .gate-rules { animation: gate-light 350ms ease-out 350ms both }
  .gate-exit { animation: gate-light 300ms ease-out 650ms both }
  @media (prefers-reduced-motion: reduce) { .gate-card, .gate-rules, .gate-exit { animation: none } }
`;
