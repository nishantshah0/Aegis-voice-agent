"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, cn } from "@/components/ui";
import type { EvidenceLine, FailureCase } from "./failure-cases";
import { CallPlayback, type PlaybackState } from "./call-playback";
import { readTestEvents, requestTest, type TestEvent, type TestSource } from "./live-events";
import { replayClips } from "./replay-clips";

type FocusAudio = (player: CallPlayback) => void;

function VoiceControls({ player, focus, idleLabel, available }: {
  player: CallPlayback; focus: FocusAudio; idleLabel: string; available: boolean;
}) {
  const state = useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  const active = ["playing", "waiting", "loading"].includes(state.mode);
  const play = () => { focus(player); player.play(); };
  const label = state.mode === "blocked" ? "Enable sound" : state.mode === "error" ? "Retry audio" :
    state.mode === "paused" ? "Resume audio" : state.mode === "done" ? "Play again" : idleLabel;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={active ? () => player.pause() : play} disabled={!available && !active}>{active ? "Pause audio" : label}</Button>
      {state.mode !== "idle" && state.mode !== "done" && <Button size="sm" variant="secondary" onClick={() => player.stop()}>Stop audio</Button>}
      {state.mode === "error" && <Button size="sm" variant="ghost" onClick={() => { focus(player); player.skip(); }}>Skip line</Button>}
      <span role="status" className="text-xs text-ink-2">
        {state.problem || ({ playing: "Playing audio", waiting: "Waiting for the next line", loading: "Loading audio", paused: "Audio paused", done: "Playback finished", idle: "", error: "", blocked: "" })[state.mode]}
      </span>
    </div>
  );
}

function Line({ value, active }: { value: EvidenceLine; active: boolean }) {
  return (
    <li value={value.line} aria-current={active ? "step" : undefined}
      className={cn("grid grid-cols-[2.6rem_1fr] gap-x-2 border-l-[3px] px-3 py-2 text-sm sm:grid-cols-[2.6rem_5.5rem_1fr]", active ? "border-accent bg-accent-soft" : "border-transparent")}>
      <span className="font-mono text-xs text-ink-3">#{value.line}</span>
      <strong className="text-xs capitalize">{value.speaker}</strong>
      <span className="col-start-2 sm:col-start-3">{value.text}</span>
    </li>
  );
}

function NowSpeaking({ state, value }: { state: PlaybackState; value?: EvidenceLine }) {
  if (!value || (state.mode !== "playing" && state.mode !== "paused")) return null;
  return <p className="mt-2 rounded border-l-[3px] border-accent bg-accent-soft px-3 py-2 text-sm">
    <strong>{state.mode === "paused" ? "Paused at" : "Now speaking"} · <span className="capitalize">{value.speaker}</span> #{value.line}</strong>
    <span className="ml-2">{value.text}</span>
  </p>;
}

function current(state: PlaybackState, index: number) {
  return (state.mode === "playing" || state.mode === "paused") && state.index === index;
}

export function SavedCallPlayer({ item, focus }: { item: FailureCase; focus: FocusAudio }) {
  const [player] = useState(() => new CallPlayback(item.transcript.map(line => ({ url: replayClips[item.id]?.[line.line] })), true));
  const state = useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => () => player.dispose(), [player]);
  const open = expanded || state.mode !== "idle";
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-ink-2">ElevenLabs voices reenact {item.id === "sam_ordinary_refill" ? "the five saved dialogue entries below" : "the supplied transcript"}.</p>
      <VoiceControls player={player} focus={focus} available={item.transcript.length > 0} idleLabel="Play saved call" />
      <NowSpeaking state={state} value={item.transcript[state.index]} />
      <button type="button" onClick={() => setExpanded(!expanded)} disabled={state.mode !== "idle"} aria-expanded={open}
        className="mt-3 cursor-pointer text-sm font-medium text-accent disabled:cursor-default">
        {open ? "Transcript" : item.transcriptLabel}
      </button>
      {open && <ol aria-label="Saved call transcript" className="mt-2 max-h-80 overflow-y-auto divide-y divide-line rounded-lg border border-line">
        {item.transcript.map((line, i) => <Line key={line.line} value={line} active={current(state, i)} />)}
      </ol>}
    </div>
  );
}

const CARDS = [
  { id: "greeting_slang_recovery", name: "Greetings and slang" },
  { id: "sam_ordinary_refill", name: "Ordinary refill" },
  { id: "corrected_consultation_time", name: "Corrected appointment time" },
];

type Status = "idle" | "starting" | "running" | "finished" | "stopped" | "failed" | "empty";
type Row = { event: TestEvent; line?: number };

export function LiveTestPlayer({ focus, preferred }: { focus: FocusAudio; preferred: string }) {
  const [choice, setChoice] = useState<{ preferred: string; id: string } | null>(null);
  const [ran, setRan] = useState("");
  const [source, setSource] = useState<TestSource>("live");
  const [runStatus, setRunStatus] = useState<Status>("idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState("");
  const [follow, setFollow] = useState(true);
  const log = useRef<HTMLOListElement>(null);
  const [player, setPlayer] = useState(() => new CallPlayback());
  const state = useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  const request = useRef<AbortController | null>(null);
  const busy = runStatus === "starting" || runStatus === "running";
  const scenario = busy ? ran : choice?.preferred === preferred ? choice.id : preferred;
  const speechRows = rows.flatMap(({ event, line }) => event.type === "line" && line ? [{ line, speaker: event.speaker, text: event.text }] : []);
  const outcome = rows.find(row => row.event.type === "verdict")?.event;
  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [follow, rows.length]);
  const voiceRows = rows.filter(row => row.event.type === "line" && row.event.ticket);
  const missingAudio = rows.some(row => row.event.type === "line" && !row.event.ticket && row.event.text !== "[Verification details omitted]");
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => player.dispose(), [player]);

  function stop() {
    request.current?.abort();
    request.current = null;
    player.stop();
    player.finish();
    setRunStatus("stopped");
  }
  async function run(nextSource: TestSource) {
    if (request.current) return;
    setProblem("");
    setRows([]);
    setRunStatus("starting");
    setFollow(nextSource === "live");
    setSource(nextSource);
    setRan(scenario);
    const controller = new AbortController();
    request.current = controller;
    const playback = new CallPlayback();
    setPlayer(playback);
    focus(playback);
    playback.play();
    let count = 0;
    try {
      const response = await requestTest(nextSource, scenario, controller.signal);
      if (controller.signal.aborted) return;
      if (nextSource === "saved" && response.status === 404) {
        setRunStatus("empty");
        return;
      }
      await readTestEvents(response, event => {
        if (controller.signal.aborted) return;
        if (event.type === "start") { setRunStatus("running"); return; }
        if (event.type === "error") { setRunStatus("failed"); setProblem(event.message); return; }
        const line = event.type === "line" ? ++count : undefined;
        setRows(existing => [...existing, { event, line }]);
        if (event.type === "line") playback.append({ ticket: event.ticket, skip: !event.ticket });
        if (event.type === "verdict") setRunStatus("finished");
      });
    } catch (error) {
      if (!controller.signal.aborted) { setRunStatus("failed"); setProblem(error instanceof Error ? error.message : "Test connection failed."); }
    } finally {
      if (request.current === controller) { request.current = null; playback.finish(); }
    }
  }
  const saved = source === "saved";
  const statusLabel = { idle: "Ready", starting: saved ? "Loading saved test" : "Connecting", running: saved ? "Loading saved test" : "Test running",
    finished: saved ? "Saved test" : "Test complete", stopped: saved ? "Replay stopped" : "Test stopped", failed: saved ? "Replay interrupted" : "Test interrupted", empty: "No saved test" }[runStatus];
  return (
    <div id="live-test" className="mt-6 border-t border-line pt-5">
      <h3 className="text-xl font-semibold">Run a live test call</h3>
      <p className="mt-1 text-sm text-ink-2">A scripted caller speaks to the pharmacy agent. Each reply, action and check appears as it arrives.</p>
      <div className="my-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Test case
          <select value={scenario} disabled={busy} onChange={event => {
            player.stop(); setChoice({ preferred, id: event.target.value }); setRows([]); setProblem(""); setRunStatus("idle");
          }} className="ml-2 rounded border border-line-strong bg-surface px-2 py-1">
            {CARDS.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
          </select>
        </label>
        <Button size="sm" disabled={busy} onClick={() => void run("live")}>{!saved && runStatus === "failed" ? "Retry live test" : "Run test live"}</Button>
        <Button size="sm" disabled={busy} variant="secondary" onClick={() => void run("saved")}>Replay last test</Button>
        {busy && <Button size="sm" variant="secondary" onClick={stop}>{saved ? "Stop replay" : "Stop test"}</Button>}
        <span role="status"><Badge tone={runStatus === "failed" ? "stop" : busy ? "accent" : "neutral"}>{statusLabel}</Badge></span>
      </div>
      {runStatus !== "idle" && <>
        <p className="mb-2 text-sm font-medium">{CARDS.find(card => card.id === ran)?.name}</p>
        {runStatus === "empty" && <p role="status" className="text-sm text-ink-2">No completed test is saved for this case. Run the test live to save its first attempt.</p>}
        {saved && rows.length > 0 && <p className="mb-2 text-xs text-ink-2">Saved test · ElevenLabs voices reenact this attempt’s recorded dialogue. Events appear in their original order.</p>}
        {(busy || speechRows.length > 0) && (!missingAudio || voiceRows.length > 0) && <VoiceControls player={player} focus={focus} idleLabel="Listen to test" available={voiceRows.length > 0} />}
        <NowSpeaking state={state} value={speechRows[state.index]} />
        {outcome?.type === "verdict" && <p role="status" className="mt-2 text-sm"><strong>Verdict · {outcome.passed ? "Passed" : "Failed"}</strong> · {outcome.caught} caught · {outcome.broken} rules broken</p>}
        {missingAudio && <p className="mt-2 text-xs text-ink-2">{voiceRows.length
          ? "Some lines are available as text only."
          : "No ElevenLabs audio is available for the received lines. Read the transcript below."}</p>}
        {problem && <p role="alert" className="mt-2 text-sm text-stop">{problem}</p>}
        {rows.length > 0 && <label className="mt-3 inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow latest events
        </label>}
        {rows.length > 0 && <ol ref={log} tabIndex={0} aria-label={saved ? "Saved test events" : "Live test events"} aria-live="polite" aria-relevant="additions"
          onWheel={event => { if (event.deltaY < 0) setFollow(false); }} onTouchStart={() => setFollow(false)}
          onKeyDown={event => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setFollow(false); }}
          className="mt-2 max-h-80 overflow-y-auto divide-y divide-line rounded-lg border border-line">
          {rows.map(({ event, line }, i) => {
            if (event.type === "line" && line) return <Line key={i} value={{ line, speaker: event.speaker, text: event.text }} active={current(state, line - 1)} />;
            if (event.type === "action") return <li key={i} className="px-3 py-2 text-xs text-ink-2"><strong>Action</strong> · {event.label}</li>;
            if (event.type === "check") return <li key={i} className="px-3 py-2 text-xs"><strong>{event.passed ? "Check passed" : "Check failed"}</strong> · {event.label}</li>;
            if (event.type === "verdict") return <li key={i} className="bg-sunken px-3 py-3 text-sm"><strong>Verdict · {event.passed ? "Passed" : "Failed"}</strong> · {event.caught} caught · {event.broken} rules broken</li>;
            return null;
          })}
        </ol>}
      </>}
    </div>
  );
}
