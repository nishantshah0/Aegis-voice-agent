"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { playClip, replayLines, speakReplayLine, type ReplayEntry, type ReplayLine } from "@/lib/voice/replay";

type Props = { entries: ReplayEntry[]; recordingUrl?: string; tickets?: Record<number, string>; verdict?: string };

/** Mount with a key for the selected call, so switching calls stops any pending voice. */
export function CallReplay({ entries, recordingUrl, tickets, verdict }: Props) {
  const lines = useMemo(() => replayLines(entries), [entries]);
  const clips = useRef(new Map<string, Blob>());
  const browserOnly = useRef(!tickets);
  const [browserVoice, setBrowserVoice] = useState(!tickets);
  const active = useRef<AbortController | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [recordingUnavailable, setRecordingUnavailable] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  const pause = () => {
    active.current?.abort();
    active.current = null;
    setPlaying(false);
  };
  async function playLine(line: ReplayLine, signal: AbortSignal) {
    const ticket = tickets?.[line.seq];
    if (ticket && !browserOnly.current) {
      try {
        let audio = clips.current.get(ticket);
        if (!audio) {
          const res = await fetch("/api/calls/replay/speak", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }), signal,
          });
          if (res.status === 401 || res.status === 403) throw new DOMException("Reopen the call to refresh playback access.", "SecurityError");
          if (!res.ok) throw new Error("ElevenLabs is unavailable.");
          audio = await res.blob();
          if (signal.aborted) return;
          clips.current.set(ticket, audio);
        }
        await playClip(audio, signal);
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof DOMException && error.name === "SecurityError") throw error;
        browserOnly.current = true;
        setBrowserVoice(true);
      }
    }
    await speakReplayLine(line, signal);
  }
  async function play(start: number) {
    active.current?.abort();
    const run = new AbortController();
    active.current = run;
    setProblem("");
    setStarted(true);
    setPlaying(true);
    try {
      for (let i = start; i < lines.length; i++) {
        setCursor(i);
        await playLine(lines[i], run.signal);
        if (run.signal.aborted) return;
      }
      setCursor(lines.length);
    } catch (error) {
      if (!run.signal.aborted) setProblem(error instanceof Error ? error.message : "Audio playback failed.");
    } finally {
      if (active.current === run) { active.current = null; setPlaying(false); }
    }
  }
  const complete = lines.length > 0 && cursor === lines.length;
  const original = Boolean(recordingUrl && !recordingUnavailable);
  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        {original ? <>
          <span className="text-sm font-medium">Call recording</span>
          <audio controls preload="none" aria-label="Original call recording" src={recordingUrl} onError={() => setRecordingUnavailable(true)} />
        </> : <>
          <Button size="sm" onClick={playing ? pause : () => void play(complete ? 0 : cursor)} disabled={!lines.length}>
            {playing ? "Pause" : complete ? "Replay again" : started ? "Resume replay" : "Play call aloud"}
          </Button>
          {cursor > 0 && !complete && <Button size="sm" variant="secondary" onClick={() => void play(0)}>Restart</Button>}
          <span className="text-xs text-ink-2">{!lines.length ? "No spoken lines in this record" : browserVoice ? "Transcript read by browser voices" : "Transcript voiced by ElevenLabs"}</span>
        </>}
      </div>
      {recordingUnavailable && <p className="mt-2 text-xs text-ink-2">The original recording is unavailable.</p>}
      {!original && <p role="status" className="mt-2 text-xs text-ink-2">
        {problem || (complete ? "Replay finished" : playing ? `${lines[cursor]?.speaker === "caller" ? "Caller" : "Pharmacy"} · line ${cursor + 1} of ${lines.length}` : "")}
      </p>}
      {verdict && <p className="mt-2 text-sm"><strong>Verdict</strong> · {verdict}</p>}
    </div>
  );
}
