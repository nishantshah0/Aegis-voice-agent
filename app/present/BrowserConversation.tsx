"use client";

import { useEffect, useRef, useState } from "react";
import "./browser-conversation.css";
import { AssistantLine, type Assistant, type DemoPatient } from "./assistant";

type Reply = {
  sessionId: string;
  step: number;
  reply: string;
  demoCode?: string;
  audioUrl?: string;
  finished?: boolean;
  verified?: boolean;
  refillRequested?: boolean;
  appointmentBooked?: string;
  assistant?: Assistant;
  demoPatient?: DemoPatient;
};
type Turn = { sessionId: string; step: number; text: string; turnId: string };
type Line = { speaker: "Pharmacy" | "You"; text: string };
type Phase = "idle" | "starting" | "permission" | "recording" | "transcribing" | "sending";

const progress: Record<Phase, string> = {
  idle: "", starting: "Opening conversation…", permission: "Waiting for microphone access…",
  recording: "Recording your reply…", transcribing: "Transcribing your reply…", sending: "Waiting for the pharmacy…",
};

class SessionClosed extends Error {}

async function post<T>(action: string, body: FormData | object, signal: AbortSignal): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/presenter/browser/${action}`, {
    method: "POST",
    signal: typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : signal,
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? body : JSON.stringify(body),
  });
  if (response.status === 410 || (response.status === 403 && action !== "start")) {
    throw new SessionClosed("This conversation is no longer available in this browser.");
  }
  if (response.status === 409) throw new SessionClosed("Another turn was already answered.");
  if (response.status === 413) throw new Error("The recording was too large. Record a shorter reply.");
  if (response.status === 422) throw new Error("No speech was detected. Record again or type your reply.");
  if (response.status === 401 || response.status === 403) throw new Error("Your presenter session expired. Sign in again.");
  if (!response.ok) throw new Error(action === "transcribe"
    ? "Transcription failed. Retry the recording or type your reply."
    : "The pharmacy could not return a reply. Try again.");
  return await response.json() as T;
}

function releaseRecorder(recorder: MediaRecorder) {
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
  if (recorder.state !== "inactive") recorder.stop();
  recorder.stream.getTracks().forEach(track => track.stop());
}

function clipFilename(type: string) {
  if (type.includes("mp4")) return "reply.mp4";
  if (type.includes("ogg")) return "reply.ogg";
  return "reply.webm";
}

export default function BrowserConversation() {
  const [session, setSession] = useState<Reply | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Turn | null>(null);
  const [clip, setClip] = useState<Blob | null>(null);
  const [playbackHint, setPlaybackHint] = useState("");
  const operation = useRef<AbortController | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => () => {
    operation.current?.abort();
    operation.current = null;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (recorder.current) releaseRecorder(recorder.current);
  }, []);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    const player = audio.current;
    if (!player || !session?.audioUrl) return;
    let current = true;
    void player.play().catch(() => {
      if (current && !player.error) setPlaybackHint("Press play to hear the pharmacy.");
    });
    return () => { current = false; player.pause(); };
  }, [session]);

  function begin(nextPhase: Phase) {
    if (operation.current) return null;
    const op = new AbortController();
    operation.current = op;
    setError("");
    setPhase(nextPhase);
    audio.current?.pause();
    return op;
  }

  function end(op: AbortController) {
    if (operation.current !== op) return;
    operation.current = null;
    setPhase("idle");
  }

  function report(op: AbortController, reason: unknown) {
    if (op.signal.aborted) return;
    if (reason instanceof SessionClosed) setClosed(true);
    setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
  }

  function accept(reply: Reply, turn?: Turn) {
    if (!reply.sessionId || typeof reply.reply !== "string" || (turn && reply.sessionId !== turn.sessionId)) {
      throw new Error("The reply was incomplete. Try again.");
    }
    setSession(old => turn ? {
      ...reply,
      verified: reply.verified || old?.verified,
      refillRequested: reply.refillRequested || old?.refillRequested,
      appointmentBooked: reply.appointmentBooked || old?.appointmentBooked,
    } : reply);
    setClosed(false);
    const pharmacy: Line = {speaker: "Pharmacy", text: reply.reply};
    setLines(previous => turn ? [...previous, {speaker: "You", text: turn.text}, pharmacy] : [pharmacy]);
    setPlaybackHint("");
    setDraft("");
    setPending(null);
    setClip(null);
  }

  async function start() {
    const op = begin("starting");
    if (!op) return;
    try {
      const reply = await post<Reply>("start", {}, op.signal);
      if (!op.signal.aborted) accept(reply);
    } catch (reason) { report(op, reason); }
    finally { end(op); }
  }

  async function sendTurn(turn: Turn, op: AbortController) {
    setPhase("sending");
    setPending(turn);
    setClip(null);
    setDraft(turn.text);
    const reply = await post<Reply>("turn", turn, op.signal);
    if (!op.signal.aborted) accept(reply, turn);
  }

  async function sendDraft() {
    if (!session || !draft.trim() || draft.trim().length > 500 || session.finished) return;
    const op = begin("sending");
    if (!op) return;
    try {
      await sendTurn(pending ?? {sessionId: session.sessionId, step: session.step, text: draft.trim(), turnId: crypto.randomUUID()}, op);
    } catch (reason) { report(op, reason); }
    finally { end(op); }
  }

  async function transcribe(blob: Blob, {sessionId, step}: Reply, op: AbortController) {
    try {
      setPhase("transcribing");
      setClip(blob);
      const form = new FormData();
      form.append("sessionId", sessionId);
      form.append("file", blob, clipFilename(blob.type));
      const result = await post<{text: string}>("transcribe", form, op.signal);
      if (op.signal.aborted) return;
      const text = result.text?.trim();
      if (!text) throw new Error("No speech was detected. Record again or type your reply.");
      if (text.length > 500) {
        setDraft(text);
        setClip(null);
        throw new Error("Your reply is longer than 500 characters. Shorten it below and send it.");
      }
      await sendTurn({sessionId, step, text, turnId: crypto.randomUUID()}, op);
    } catch (reason) { report(op, reason); }
    finally { end(op); }
  }

  async function record() {
    if (!session || session.finished) return;
    const op = begin("permission");
    if (!op) return;
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser cannot record audio. Type your reply below.");
      }
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (op.signal.aborted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
      const captured = new MediaRecorder(stream, type ? {mimeType: type} : undefined);
      recorder.current = captured;
      const chunks: Blob[] = [];
      const cleanup = () => {
        if (stopTimer.current) clearTimeout(stopTimer.current);
        releaseRecorder(captured);
        recorder.current = null;
      };
      captured.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      captured.onerror = () => {
        cleanup();
        report(op, new Error("Recording stopped unexpectedly. Record again or type your reply."));
        end(op);
      };
      captured.onstop = () => {
        cleanup();
        if (op.signal.aborted) return;
        const blob = new Blob(chunks, {type: captured.mimeType || chunks[0]?.type});
        if (blob.size) { void transcribe(blob, session, op); return; }
        report(op, new Error("The recording was empty. Record again or type your reply."));
        end(op);
      };
      captured.start();
      setClip(null);
      setPhase("recording");
      stopTimer.current = setTimeout(() => { if (captured.state === "recording") captured.stop(); }, 45_000);
    } catch (reason) {
      stream?.getTracks().forEach(track => track.stop());
      // A cancelled permission prompt may settle after another recording starts.
      if (op.signal.aborted) return;
      recorder.current = null;
      const problem = reason instanceof DOMException ? new Error(
        reason.name === "NotAllowedError" ? "Allow microphone access in your browser, or type your reply below."
          : "The microphone is unavailable. Check the input device or type your reply below."
      ) : reason;
      report(op, problem);
      end(op);
    }
  }

  const busy = phase !== "idle";
  return <section className="presenter-card browser-conversation" aria-labelledby="browser-conversation-title">
    <h2 id="browser-conversation-title">Talk to the pharmacy</h2>
    {!session && <>
      <p>Play the patient in a browser conversation. Listen to the pharmacy, then record or type your reply.</p>
      <button type="button" className="presenter-primary" disabled={busy} onClick={start}>Start conversation</button>
    </>}
    {session && <>
      <AssistantLine assistant={session.assistant} patient={session.finished ? undefined : session.demoPatient} />
      {session.demoCode && <div className="presenter-code"><span>Demo verification code</span><b>{session.demoCode}</b></div>}
      <ol className="browser-transcript" aria-label="Conversation transcript" aria-live="polite" ref={log}>
        {lines.map((line, index) => <li key={index}><b>{line.speaker}</b><span>{line.text}</span></li>)}
      </ol>
      {session.audioUrl && <audio key={lines.length} ref={audio} controls preload="auto" src={session.audioUrl} aria-label="Pharmacy reply"
        onPlay={() => setPlaybackHint("")} onError={() => setPlaybackHint("Audio is unavailable. You can retry playback or read the reply above.")} />}
      {playbackHint && <div className="browser-playback">
        <p className="browser-hint" role="status">{playbackHint}</p>
        <button type="button" className="presenter-plain" disabled={busy} onClick={() => {
          const player = audio.current;
          if (!player) return;
          if (player.error) player.load();
          void player.play().catch(() => setPlaybackHint("Read the pharmacy reply above, or try playback again."));
        }}>Play reply</button>
      </div>}
      {(session.verified || session.refillRequested || session.appointmentBooked) && <ul className="browser-outcomes" aria-label="Confirmed outcomes">
        {session.verified && <li>Identity verified</li>}
        {session.refillRequested && <li>Refill requested</li>}
        {session.appointmentBooked && <li><span>Appointment booked</span> · {session.appointmentBooked}</li>}
      </ul>}
      {session.finished || closed ? <div className="browser-complete">
        <strong>{closed ? "Conversation closed" : "Conversation complete"}</strong>
        <button type="button" className="presenter-plain" disabled={busy} onClick={start}>Start another conversation</button>
      </div> : <>
        <div className="browser-actions">
          {phase === "recording" ? <button type="button" className="presenter-primary browser-stop" onClick={() => {
            if (recorder.current?.state === "recording") recorder.current.stop();
          }}>Stop and send</button> : <button type="button" className="presenter-primary" onClick={record} disabled={busy || !!pending}>Record reply</button>}
          {phase === "permission" && <button type="button" className="presenter-plain" onClick={() => {
            const op = operation.current;
            if (op) { op.abort(); end(op); }
          }}>Cancel</button>}
          {clip && !busy && <button type="button" className="presenter-plain" onClick={() => {
            const op = begin("transcribing");
            if (op) void transcribe(clip, session, op);
          }}>Retry transcription</button>}
        </div>
        <form className="browser-compose" onSubmit={event => { event.preventDefault(); void sendDraft(); }}>
          <label htmlFor="browser-typed-reply">Type your reply</label>
          <input id="browser-typed-reply" value={draft} onChange={event => setDraft(event.target.value)} readOnly={!!pending}
            disabled={busy} maxLength={500} autoComplete="off" />
          <button type="submit" disabled={busy || !draft.trim() || draft.trim().length > 500}>{pending && !busy ? "Retry reply" : "Send reply"}</button>
        </form>
      </>}
    </>}
    {busy && <p className="browser-hint" role="status">{progress[phase]}</p>}
    {error && <p className="presenter-error" role="alert">{error}</p>}
  </section>;
}
