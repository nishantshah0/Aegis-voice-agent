"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LiveCall, LiveTurn } from "@/app/api/_lib/live-calls";
import { ruleWords } from "@/app/stage/attacks";
import { Badge, Button, RuleTag, TableEmpty, cn } from "@/components/ui";
import { RunLiveCallButton, type LiveSourceInput } from "../../live-calls/RunLiveCallButton";

// One live attack call: the attacker AI against the real pharmacy agent, on a simulated
// line. Polls GET /api/arena/live/:id while the call is going; the same data replays it
// after. Audio comes from POST /api/arena/live/:id/speak (never a blocked line: a buzzer
// plays instead, then the line that was said in its place).

const POLL_MS = 700;

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const DECISION_TONE: Record<string, "accent" | "stop" | "quick" | "review" | "neutral"> = { allowed: "accent", blocked: "stop", refused: "stop", routed: "quick", flagged: "review" };

/** A short two-tone buzzer for a blocked line, made in the browser (no file, no text). */
function buzz(ctx: AudioContext): Promise<void> {
  return new Promise((resolve) => {
    const t = ctx.currentTime;
    for (const [i, f] of [180, 140].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.18, t + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.22);
      osc.stop(t + i * 0.22 + 0.21);
    }
    setTimeout(resolve, 500);
  });
}

/** A soft tick for a button press. */
function tick(ctx: AudioContext): Promise<void> {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.09);
  return new Promise((r) => setTimeout(r, 160));
}

function useVoice(callId: string) {
  const cache = useRef(new Map<string, Promise<string | null>>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const clip = useCallback(
    (seq: number, say?: "replacement") => {
      const key = `${seq}:${say ?? ""}`;
      let p = cache.current.get(key);
      if (!p) {
        p = fetch(`/api/arena/live/${encodeURIComponent(callId)}/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(say ? { seq, say } : { seq }) })
          .then(async (res) => {
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              setProblem(body.error ?? `The voice answered ${res.status}`);
              return null;
            }
            return URL.createObjectURL(await res.blob());
          })
          .catch(() => {
            setProblem("Can't reach the voice");
            return null;
          });
        cache.current.set(key, p);
      }
      return p;
    },
    [callId],
  );

  const playUrl = useCallback((url: string | null) => {
    if (!url) return Promise.resolve();
    audio.current ??= new Audio();
    const a = audio.current;
    a.src = url;
    return new Promise<void>((resolve) => {
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.onpause = () => resolve();
      void a.play().catch(() => resolve());
    });
  }, []);

  const audioCtx = () => (ctx.current ??= new AudioContext());

  /** Plays one turn as it was heard on the line. */
  const playTurn = useCallback(
    async (t: LiveTurn) => {
      if (t.kind === "caller_line" || t.kind === "line_spoken") return playUrl(await clip(t.seq));
      if (t.kind === "safety") {
        await playUrl(await clip(t.seq));
        if (t.replacement) await playUrl(await clip(t.seq, "replacement"));
        return;
      }
      if (t.kind === "line_blocked") {
        await buzz(audioCtx());
        if (t.replacement) await playUrl(await clip(t.seq, "replacement"));
        return;
      }
      if (t.kind === "button") await tick(audioCtx());
    },
    [clip, playUrl],
  );

  const stop = useCallback(() => audio.current?.pause(), []);
  return { playTurn, stop, problem, prime: () => void audioCtx().resume() };
}

function TurnRow({ t, playing, onPlay }: { t: LiveTurn; playing: boolean; onPlay: () => void }) {
  const time = <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{clock(t.at)}</span>;
  const caughtFlag = t.caught && (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-stop">
      <span aria-hidden className="size-2 rounded-full bg-stop" /> Caught at {clock(t.at)}
    </span>
  );
  const ring = playing ? "ring-2 ring-accent" : "";

  if (t.kind === "caller_line" || t.kind === "safety") {
    return (
      <li id={`turn-${t.seq}`} className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {caughtFlag}
          {time}
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Attacker</span>
        </div>
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-br-md bg-sunken px-4 py-2.5 text-left text-[15px] hover:brightness-110", ring)}>
          {t.text}
          {t.kind === "safety" && <span className="mt-1 block text-xs text-review">Safety check on this line: {t.decision}</span>}
        </button>
        {t.kind === "safety" && t.replacement && <p className="max-w-[78%] rounded-2xl border border-line px-4 py-2 text-[15px]">{t.replacement}</p>}
      </li>
    );
  }
  if (t.kind === "line_spoken") {
    return (
      <li id={`turn-${t.seq}`} className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Pharmacy</span>
          {time}
        </div>
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-bl-md border border-line px-4 py-2.5 text-left text-[15px] hover:border-line-strong", ring)}>
          {t.text}
        </button>
      </li>
    );
  }
  if (t.kind === "line_blocked") {
    return (
      <li id={`turn-${t.seq}`} className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Pharmacy</span>
          {time}
          {caughtFlag}
        </div>
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-bl-md border-2 border-stop/60 bg-stop-soft px-4 py-2.5 text-left text-[15px]", ring)}>
          <span className="flex items-center gap-2 text-xs font-medium text-stop">
            <RuleTag className="border-stop/50 text-stop">{t.rule}</RuleTag> {ruleWords(t.rule ?? "")}: never said, replaced
          </span>
          <span className="mt-1.5 block text-ink-3 line-through decoration-stop decoration-2">{t.text}</span>
          <span className="mt-1 block">{t.replacement}</span>
        </button>
      </li>
    );
  }
  if (t.kind === "button") {
    return (
      <li id={`turn-${t.seq}`} className="flex items-center gap-2 pl-2">
        {time}
        <button
          type="button"
          onClick={onPlay}
          title={t.input ? `Pressed with ${JSON.stringify(t.input)}` : undefined}
          className={cn("flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-1.5 font-mono text-[13px]", t.caught ? "border-stop/60" : "border-line-strong", ring)}
        >
          <span className="text-ink-3">pressed</span>
          <span className="font-semibold">{t.button}</span>
          <Badge tone={DECISION_TONE[t.decision] ?? "neutral"}>{t.decision}</Badge>
          {t.ruleIds.map((r) => (
            <span key={r} className="flex items-center gap-1" title={ruleWords(r)}>
              <RuleTag>{r}</RuleTag>
            </span>
          ))}
        </button>
        {caughtFlag}
      </li>
    );
  }
  return null;
}

export function LiveCallView({ id }: { id: string }) {
  const [call, setCall] = useState<LiveCall | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(0);
  const [usage, setUsage] = useState<{ used: number; perHour: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const voice = useVoice(id);
  const running = call?.state === "ringing" || call?.state === "connected";

  // Follow the call while it's going.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const res = await fetch(`/api/arena/live/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (res.status === 404) setMissing(true);
        if (res.ok) {
          const next = (await res.json()) as LiveCall;
          setCall(next);
          if (next.state === "ended" || next.state === "failed") return;
        }
      } catch {
        // Try again on the next tick.
      }
      if (!stopped) timer = setTimeout(load, POLL_MS);
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  // The running clock, and the hour's usage.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const load = () =>
      fetch("/api/arena/live", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { usage?: { used: number; perHour: number } } | null) => b?.usage && setUsage(b.usage))
        .catch(() => {});
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const turns = useMemo(() => call?.turns ?? [], [call]);
  const audible = turns;

  // The player: plays turns[cursor], then the next, waiting for new ones while the call is live.
  const busy = useRef(false);
  useEffect(() => {
    if (!playing || busy.current) return;
    const t = audible[cursor];
    if (!t) return; // Wait for the next turn while the call is live.
    busy.current = true;
    document.getElementById(`turn-${t.seq}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    void voice.playTurn(t).finally(() => {
      busy.current = false;
      setCursor((c) => c + 1);
    });
  }, [playing, cursor, audible, running, voice]);

  const playFrom = (index: number) => {
    voice.prime();
    voice.stop();
    setCursor(index);
    setPlaying(true);
  };
  // Playing, and not run out of turns on a finished call.
  const active = playing && (running || cursor < audible.length);
  const pause = () => {
    setPlaying(false);
    voice.stop();
  };

  if (missing) return <p className="text-sm text-ink-2">No live call with that id. It may be from another server.</p>;
  if (!call) return <p className="text-sm text-ink-3">Dialling…</p>;

  const start = call.connectedAt ? Date.parse(call.connectedAt) : Date.parse(call.startedAt);
  const end = call.endedAt ? Date.parse(call.endedAt) : now || start;
  const duration = Math.max(1, end - start);
  const span = Math.max(duration, ...turns.map((t) => t.at + 500));
  const caught = turns.filter((t) => t.caught);
  const inbound = call.phone.direction === "inbound";
  const source: LiveSourceInput | null = call.source.kind === "new" ? null : (call.source as LiveSourceInput);

  return (
    <div className="flex flex-col gap-6">
      {/* The line */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className={cn("flex size-12 items-center justify-center rounded-full text-2xl", running ? "bg-accent text-ink-inverse" : "bg-sunken text-ink-2", call.state === "ringing" && "animate-pulse")} aria-hidden>
              ☎
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[-0.01em]">
                {inbound ? (
                  <>
                    {call.phone.other} <span className="text-ink-3">(attacker)</span> <span aria-hidden className="text-ink-3">→</span> {call.phone.pharmacy}
                  </>
                ) : (
                  <>
                    {call.phone.pharmacy} <span aria-hidden className="text-ink-3">→</span> {call.phone.other} <span className="text-ink-3">(attacker answers)</span>
                  </>
                )}
              </p>
              <p className="text-xs text-ink-3">
                Simulated line: no phone network, both sides are AI on this server · attacker {call.attacker === "gemini" ? "Gemini" : "Claude"}{call.attackerModel ? ` (${call.attackerModel})` : ""} · pharmacy {call.model ?? "Haiku"} · {call.title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={call.state === "failed" ? "stop" : running ? "accent" : "neutral"} dot>
              {call.state === "ringing" ? "Ringing…" : call.state === "connected" ? "Connected" : call.state === "ended" ? "Call ended" : "Call failed"}
            </Badge>
            <span className="font-mono text-3xl font-semibold tabular-nums tracking-[-0.02em]" aria-label="Call duration">
              {clock(call.connectedAt ? duration : 0)}
            </span>
          </div>
        </div>

        {/* Timeline: every turn at its time; red marks where the lock caught something */}
        <div className="mt-5">
          <div className="relative h-8 rounded-full bg-sunken" role="list" aria-label="Call timeline">
            {turns.map((t, i) => (
              <button
                key={`${t.seq}-${t.kind}`}
                type="button"
                role="listitem"
                onClick={() => {
                  document.getElementById(`turn-${t.seq}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                  playFrom(i);
                }}
                title={`${clock(t.at)} · ${t.caught ? `Caught: ${t.rule ?? t.ruleIds.join(", ") ?? t.decision}` : t.kind.replace(/_/g, " ")}`}
                className={cn(
                  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full transition-transform hover:scale-150",
                  t.caught ? "z-10 h-6 w-2 bg-stop" : t.who === "caller" ? "size-2.5 bg-ink-2" : t.kind === "button" ? "size-1.5 bg-ink-3" : "size-2.5 bg-accent",
                  active && i === cursor && "ring-2 ring-accent",
                )}
                style={{ left: `${Math.min(98, Math.max(2, (t.at / span) * 100))}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
            <span className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-2" />Attacker</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" />Pharmacy</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full bg-stop" />Caught ({caught.length})</span>
            </span>
            <span>{usage ? `${usage.used} of ${usage.perHour} model calls this hour` : ""}</span>
          </div>
        </div>

        {/* Audio */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {active ? (
            <Button size="sm" variant="secondary" onClick={pause}>
              ❚❚ Pause
            </Button>
          ) : (
            <Button size="sm" onClick={() => playFrom(cursor >= turns.length ? 0 : cursor)}>
              ▶ {running ? "Listen live" : cursor > 0 && cursor < turns.length ? "Resume" : "Play the call"}
            </Button>
          )}
          <span className="text-xs text-ink-3">
            Two voices: the attacker and the pharmacy. A blocked line is never voiced: you hear a buzzer, then what was said instead. Click any turn to play from there.
          </span>
          {voice.problem && <span className="text-xs text-stop">Voice: {voice.problem}. The call is still here as text.</span>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-live="polite">
          {turns.length === 0 ? (
            <TableEmpty>{call.state === "ringing" ? "Ringing…" : "Waiting for the first line…"}</TableEmpty>
          ) : (
            <ol className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              {turns.map((t, i) => (
                <TurnRow key={`${t.seq}-${t.kind}`} t={t} playing={active && i === cursor} onPlay={() => playFrom(i)} />
              ))}
              {running && <li className="text-center text-xs text-ink-3 animate-pulse">On the line…</li>}
            </ol>
          )}
        </section>

        <aside className="flex flex-col gap-4 text-sm">
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">The attack</p>
            <p className="mt-2 font-medium">{call.attack.goal}</p>
            <p className="mt-1 text-ink-2">{call.attack.persona}</p>
            <p className="mt-2 text-xs text-ink-3">
              Up to {call.attack.turns} caller turns · {call.attack.direction === "inbound" ? "attacker rings in" : "pharmacy rings out"}
            </p>
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">Verdict</p>
            {call.verdict ? (
              <dl className="mt-2 grid grid-cols-2 gap-y-2">
                <dt className="text-ink-2">Caught</dt>
                <dd className="text-right text-lg font-semibold tabular-nums">{call.verdict.caught}</dd>
                <dt className="text-ink-2">Rules broken</dt>
                <dd className={cn("text-right text-lg font-semibold tabular-nums", call.verdict.broken.length ? "text-stop" : "text-accent")}>{call.verdict.broken.length}</dd>
                <dt className="text-ink-2">Record</dt>
                <dd className={cn("text-right font-medium", call.verdict.recordVerified ? "text-accent" : "text-stop")}>{call.verdict.recordVerified ? "Chain verified" : "Not verified"}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-ink-3">When the call ends: what the lock caught, anything the hammer&apos;s invariants say broke, and the record&apos;s hash chain.</p>
            )}
            {call.verdict?.broken.map((b, i) => (
              <p key={i} className="mt-2 text-xs text-stop">
                {b.rule}: {b.detail}
              </p>
            ))}
            {call.message && <p className="mt-2 text-xs text-stop">{call.message}</p>}
          </div>
          {caught.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">When the lock caught it</p>
              <ul className="mt-2 space-y-1.5">
                {caught.map((t) => (
                  <li key={`${t.seq}-c`}>
                    <button type="button" className="flex w-full cursor-pointer items-center gap-2 text-left hover:text-ink" onClick={() => playFrom(turns.indexOf(t))}>
                      <span className="font-mono text-xs tabular-nums text-stop">{clock(t.at)}</span>
                      <span className="truncate text-ink-2">
                        {t.kind === "line_blocked" ? `${t.rule}: line replaced` : t.kind === "button" ? `${t.button} ${t.decision}${t.ruleIds.length ? ` (rule ${t.ruleIds.join(", ")})` : ""}` : `caller line ${t.decision}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!running && (
            <div className="flex flex-wrap gap-2">
              {source && <RunLiveCallButton source={source} label="Run it again" />}
              <Link href="/app/safety/live-calls" className="inline-flex h-8 items-center rounded-full border border-line-strong px-3.5 text-[13px] hover:border-ink-3">
                Run another
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
