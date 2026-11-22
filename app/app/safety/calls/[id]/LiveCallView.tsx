"use client";

import { useEffectEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { playClip, replayLines, speakReplayLine } from "@/lib/voice/replay";
import type { LiveCall, LiveTurn } from "@/app/api/_lib/live-calls";
import { ruleWords } from "@/app/stage/attacks";
import { Badge, Button, ButtonLink, RuleTag, TableEmpty, When, cn } from "@/components/ui";
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

function progressMessage(progress: NonNullable<LiveCall["progress"]>, caller: LiveCall["attacker"]) {
  switch (progress.phase) {
    case "connecting": return "Connecting the simulated call.";
    case "caller": return `${caller === "gemini" ? "Gemini" : "Claude"} is preparing caller turn ${progress.turn} from the conversation so far.`;
    case "pharmacy": return `Waiting for the pharmacy’s response to turn ${progress.turn}.`;
    case "scoring": return "Checking the call record for the verdict.";
    case "failed": return "Call interrupted.";
    case "finished": return "Call complete.";
  }
}

function callStatus(call: LiveCall) {
  const state = String(call.state);
  const phase = call.progress?.phase;
  if (state === "cancelled" || state === "canceled") return { label: "Cancelled", tone: "neutral" as const };
  if (state === "failed" || phase === "failed") return { label: "Failed", tone: "stop" as const };
  if (state === "ended") return { label: "Completed", tone: "accent" as const };
  if (phase === "finished") return { label: "Finishing", tone: "quick" as const };
  if (state === "queued") return { label: "Queued", tone: "quick" as const };
  if (phase === "scoring") return { label: "Scoring", tone: "quick" as const };
  if (state === "connected" || phase === "caller" || phase === "pharmacy") return { label: "Active", tone: "accent" as const };
  if (state === "ringing" || phase === "connecting") return { label: "Connecting", tone: "quick" as const };
  return { label: "Status unavailable", tone: "neutral" as const };
}

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
  const cache = useRef(new Map<string, Blob>());
  const ctx = useRef<AudioContext | null>(null);
  const browserOnly = useRef(false);
  const [source, setSource] = useState("Generated voices from the saved transcript");
  const [problem, setProblem] = useState("");
  useEffect(() => () => { void ctx.current?.close().catch(() => {}); }, []);

  const playTurn = async (turn: LiveTurn, signal: AbortSignal) => {
    if (turn.kind === "button" && ctx.current) return tick(ctx.current);
    if (turn.kind === "line_blocked" && ctx.current) await buzz(ctx.current);
    const [line] = replayLines([turn]);
    if (!line || signal.aborted) return;

    if (!browserOnly.current) {
      const key = `${callId}:${turn.seq}`;
      try {
        let blob = cache.current.get(key);
        if (!blob) {
          const body = turn.kind === "line_blocked" ? { seq: turn.seq, say: "replacement" } : { seq: turn.seq };
          const res = await fetch(`/api/arena/live/${encodeURIComponent(callId)}/speak`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
          });
          if (res.status === 401 || res.status === 403) throw new DOMException("Sign in to play this call.", "NotAllowedError");
          if (!res.ok) throw new Error("The voice service is unavailable.");
          blob = await res.blob();
          if (signal.aborted) return;
          cache.current.set(key, blob);
        }
        await playClip(blob, signal);
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") throw error;
        browserOnly.current = true;
        setSource("Transcript read by browser voices");
      }
    }
    await speakReplayLine(line, signal);
  };

  const prime = () => {
    setProblem("");
    if (typeof AudioContext !== "undefined") {
      ctx.current ??= new AudioContext();
      void ctx.current.resume().catch(() => {});
    }
  };
  return { playTurn, problem, setProblem, source, prime };
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
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-br-md bg-sunken px-4 py-2.5 text-left text-[15px] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", ring)}>
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
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-bl-md border border-line px-4 py-2.5 text-left text-[15px] hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", ring)}>
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
        <button type="button" onClick={onPlay} title="Play from here" className={cn("max-w-[78%] cursor-pointer rounded-2xl rounded-bl-md border-2 border-stop/60 bg-stop-soft px-4 py-2.5 text-left text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", ring)}>
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
          className={cn("flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-1.5 font-mono text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", t.caught ? "border-stop/60" : "border-line-strong", ring)}
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
  const callRef = useRef<LiveCall | null>(null);
  const [missing, setMissing] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [now, setNow] = useState(0);
  const [newEvents, setNewEvents] = useState(0);
  const timelineRef = useRef<HTMLOListElement | null>(null);
  const nearLatest = useRef(true);
  const [usage, setUsage] = useState<{ used: number; perHour: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const voice = useVoice(id);
  const state = String(call?.state ?? "");
  const phase = call?.progress?.phase;
  const running = (state === "queued" || state === "ringing" || state === "connected") && phase !== "failed" && phase !== "finished";

  useEffect(() => {
    const update = () => {
      nearLatest.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Follow the call while it's going.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    callRef.current = null;
    setCall(null);
    setMissing(false);
    setConnectionIssue(false);
    setNewEvents(0);
    async function load() {
      try {
        const res = await fetch(`/api/arena/live/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) throw new Error(`Call request failed (${res.status})`);
        if (res.ok) {
          const next = (await res.json()) as LiveCall;
          if (stopped) return;
          const previous = callRef.current;
          const added = previous ? Math.max(0, next.turns.length - previous.turns.length) : 0;
          if (added > 0 && !nearLatest.current) setNewEvents((count) => count + added);
          if (added > 0 && nearLatest.current) {
            requestAnimationFrame(() => timelineRef.current?.lastElementChild?.scrollIntoView({
              block: "end",
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            }));
          }
          callRef.current = next;
          setCall(next);
          setConnectionIssue(false);
          const nextState = String(next.state);
          if (nextState === "ended" || nextState === "failed" || nextState === "cancelled" || nextState === "canceled" || next.progress?.phase === "failed" || next.progress?.phase === "finished") return;
        }
      } catch {
        if (!stopped) setConnectionIssue(true);
      }
      if (!stopped) timer = setTimeout(load, POLL_MS);
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  // Update elapsed time only while the saved call is active.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  // The hour's usage.
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
  const [seek, setSeek] = useState(0);
  const activeTurn = useRef<AbortController | null>(null);
  const turnSeq = audible[cursor]?.seq;
  const playCurrent = useEffectEvent(async (signal: AbortSignal) => {
    if (signal.aborted) return;
    const turn = audible[cursor];
    if (!turn) return;
    document.getElementById(`turn-${turn.seq}`)?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    try {
      await voice.playTurn(turn, signal);
      if (!signal.aborted) setCursor((c) => c + 1);
    } catch (error) {
      if (signal.aborted) return;
      voice.setProblem(error instanceof Error ? error.message : "Audio playback failed.");
      setPlaying(false);
    }
  });
  useEffect(() => {
    if (!playing || turnSeq === undefined) return;
    const controller = new AbortController();
    activeTurn.current = controller;
    queueMicrotask(() => void playCurrent(controller.signal));
    return () => controller.abort();
  }, [playing, turnSeq, seek]);

  const playFrom = (index: number) => {
    activeTurn.current?.abort();
    voice.prime();
    setCursor(index);
    setSeek((n) => n + 1);
    setPlaying(true);
  };
  const active = playing && (running || cursor < audible.length);
  const pause = () => {
    activeTurn.current?.abort();
    setPlaying(false);
  };

  if (missing) return (
    <div role="status" className="mt-4 rounded-card border border-line bg-surface p-5 text-sm text-ink-2">
      <p className="font-medium text-ink">This simulated call is unavailable on this server.</p>
      <p className="mt-1">Return to Live calls and open a saved call from this workspace.</p>
      <Link href="/app/safety/live-calls" className="mt-3 inline-flex text-sm font-medium text-accent underline underline-offset-2">Back to Live calls</Link>
    </div>
  );
  if (!call) return (
    <div role="status" className="mt-4 rounded-card border border-line bg-surface p-5 text-sm text-ink-2">
      <p className="font-medium text-ink">{connectionIssue ? "Can’t reach this saved call yet." : "Opening simulated call…"}</p>
      <p className="mt-1">{connectionIssue ? "Checking again shortly. Keep this page open or return to Live calls." : "Loading its status and transcript."}</p>
      <Link href="/app/safety/live-calls" className="mt-3 inline-flex text-sm font-medium text-accent underline underline-offset-2">Back to Live calls</Link>
    </div>
  );

  const start = call.connectedAt ? Date.parse(call.connectedAt) : Date.parse(call.startedAt);
  const end = call.endedAt ? Date.parse(call.endedAt) : now || (running ? Date.now() : Date.parse(call.startedAt));
  const duration = Math.max(0, end - start);
  const span = Math.max(duration, ...turns.map((t) => t.at + 500));
  const caught = turns.filter((t) => t.caught);
  const inbound = call.phone.direction === "inbound";
  const status = callStatus(call);
  const source: LiveSourceInput | null = call.source.kind === "new" ? null : (call.source as LiveSourceInput);
  const sourceLabel = call.source.kind === "new" ? "One-off attack" : `${call.source.kind} · ${call.source.id}`;

  function returnToLatest() {
    setNewEvents(0);
    const last = timelineRef.current?.lastElementChild;
    last?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The line */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className={cn("flex size-12 items-center justify-center rounded-full text-2xl", running ? "bg-accent text-ink-inverse" : "bg-sunken text-ink-2", call.state === "ringing" && "motion-safe:animate-pulse")} aria-hidden>
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
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Badge tone={status.tone} dot aria-live="polite">{status.label}</Badge>
            <span className="font-mono text-2xl font-semibold tabular-nums tracking-[-0.02em]" aria-label={`Elapsed ${clock(duration)}`}>
              {clock(duration)} <span className="font-sans text-xs font-normal text-ink-3">elapsed</span>
            </span>
          </div>
        </div>

        <dl className="mt-4 grid gap-x-5 gap-y-2 border-t border-line pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-ink-3">Call ID</dt><dd className="mt-0.5 break-all font-mono text-ink-2">{call.id}</dd></div>
          <div><dt className="text-ink-3">Test source</dt><dd className="mt-0.5 break-all text-ink-2">{sourceLabel}</dd></div>
          <div><dt className="text-ink-3">Started</dt><dd className="mt-0.5 text-ink-2"><When iso={call.startedAt} /></dd></div>
          <div><dt className="text-ink-3">Connected</dt><dd className="mt-0.5 text-ink-2">{call.connectedAt ? <When iso={call.connectedAt} /> : "Not connected"}</dd></div>
        </dl>

        {connectionIssue && <p role="status" className="mt-3 rounded-md bg-quick-soft px-3 py-2 text-sm text-ink-2">Connection interrupted. Checking for updates again; this view remains on call <code className="font-mono text-xs">{call.id}</code>.</p>}

        {call.progress && (
          <div className="mt-4 text-sm text-ink-2" role="status">
            <p>{progressMessage(call.progress, call.attacker)}</p>
            <p className="text-xs text-ink-3">{call.progress.completed} exchanges completed · limit {call.attack.turns}</p>
          </div>
        )}

        {/* Timeline: every turn at its time; red marks where the lock caught something */}
        <div className="mt-5">
          <div className="relative h-8 rounded-full bg-sunken" role="group" aria-label="Call timeline. Select a marker to open and replay that turn.">
            {turns.map((t, i) => (
              <button
                key={`${t.seq}-${t.kind}`}
                type="button"
                onClick={() => {
                  document.getElementById(`turn-${t.seq}`)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                  playFrom(i);
                }}
                aria-label={`${clock(t.at)} · ${t.who === "caller" ? "Attacker" : t.who === "agent" ? "Pharmacy" : "System"}${t.caught ? ` · caught by ${t.rule ?? t.ruleIds.join(", ") ?? t.decision}` : ""}`}
                title={`${clock(t.at)} · ${t.caught ? `Caught: ${t.rule ?? t.ruleIds.join(", ") ?? t.decision}` : t.kind.replace(/_/g, " ")}`}
                className={cn(
                  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full transition-transform hover:scale-150 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
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
            <Button size="sm" disabled={!running && !turns.length} onClick={() => playFrom(cursor >= turns.length ? 0 : cursor)}>
              ▶ {running ? "Listen live" : cursor > 0 && cursor < turns.length ? "Resume" : "Play the call"}
            </Button>
          )}
          <span className="text-xs text-ink-3">
            {turns.length ? `Transcript replay available · ${voice.source}. Select a turn to play from there. A buzz marks a blocked line, followed by what the caller heard.` : "No transcript audio is available yet."}
          </span>
          {voice.problem && <span role="status" className="text-xs text-stop">{voice.problem}</span>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="transcript-heading">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="transcript-heading" className="text-sm font-semibold">Call transcript and events</h2>
            {newEvents > 0 && (
              <Button size="sm" variant="secondary" onClick={returnToLatest}>
                {newEvents} new event{newEvents === 1 ? "" : "s"} · Return to latest
              </Button>
            )}
          </div>
          {turns.length === 0 ? (
            <TableEmpty>{status.label === "Connecting" ? "Connecting the simulated call…" : "Waiting for the first event…"}</TableEmpty>
          ) : (
            <ol ref={timelineRef} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              {turns.map((t, i) => (
                <TurnRow key={`${t.seq}-${t.kind}`} t={t} playing={active && i === cursor} onPlay={() => playFrom(i)} />
              ))}
              {running && <li className="text-center text-xs text-ink-3 motion-safe:animate-pulse">{status.label} · waiting for next event…</li>}
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
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{call.state === "failed" ? "Incomplete call · partial checks" : "Verdict"}</p>
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
              <p className="mt-2 text-ink-3">{running ? "The verdict will appear when the call ends." : "No verdict was saved for this call."}</p>
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
              <ButtonLink href="/app/safety/live-calls" variant="secondary" size="sm">
                Run another
              </ButtonLink>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
