"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, chipClass } from "@/components/ui";
import { CallPlayback } from "../simulation/call-playback";
import { clipsFor, clipsFromEvents } from "../simulation/live-clips";
import { readTestEvents, requestTest, type TestEvent } from "../simulation/live-events";
import { AssistantLine, type Assistant, type DemoPatient } from "./assistant";

interface PhoneSession {
  callId: string;
  status: string;
  message: string;
  updatedAt?: string;
  demoCode?: string;
  appointmentBooked?: string;
  refillRequested?: boolean;
  assistant?: Assistant;
  demoPatient?: DemoPatient;
  notice?: string;
}

const finished = (status: string) => /^(?:completed|failed|busy|no[-_ ]answer|cancelled|canceled|ended|rejected|expired|unconfirmed)$/i.test(status);

async function readPhone(response: Response): Promise<PhoneSession> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || `Phone service returned HTTP ${response.status}.`);
  if (!data || typeof data.callId !== "string" || !data.callId || typeof data.status !== "string" || !data.status) {
    throw new Error("The phone service returned an incomplete update.");
  }
  return data;
}

const describe = (e: unknown) => e instanceof Error ? e.message : "The connection was interrupted.";

export function PhoneControl() {
  const [call, setCall] = useState<PhoneSession>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const startRequest = useRef<AbortController | null>(null);
  const requestKey = useRef<string | null>(null);
  useEffect(() => () => startRequest.current?.abort(), []);

  const callId = call?.callId;
  const active = Boolean(call && !finished(call.status));
  const dialPending = active && call?.status !== "unconfirmed";
  useEffect(() => {
    if (!callId || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const url = `/api/presenter/phone/status?callId=${encodeURIComponent(callId!)}`;
        const current = await readPhone(await fetch(url, { cache: "no-store", signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (current.callId !== callId) throw new Error("The update belongs to another call.");
        setCall(current);
        setError("");
        if (finished(current.status)) return;
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(`Checking again shortly. ${describe(e)}`);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [callId, active]);

  async function start() {
    if (startRequest.current || dialPending) return;
    const controller = new AbortController();
    startRequest.current = controller;
    setStarting(true);
    setCall(undefined);
    setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/presenter/phone/start", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current },
        body: "{}", cache: "no-store", signal: controller.signal,
      });
      const created = await readPhone(response);
      if (!controller.signal.aborted) {
        setCall(created);
        requestKey.current = null;
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(describe(e));
    } finally {
      startRequest.current = null;
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  const updatedAt = call?.updatedAt ? new Date(call.updatedAt) : undefined;
  return <section className="presenter-card" id="phone" aria-labelledby="phone-heading">
    <h2 id="phone-heading">Test phone call</h2>
    <p>Aegis calls the configured test phone so you can speak with the pharmacy.</p>
    <button type="button" className="presenter-primary" onClick={start} disabled={starting || dialPending}>{starting ? "Starting call…" : dialPending ? "Call in progress" : "Call my test phone"}</button>
    {call && <div className="presenter-call" role="status" aria-live="polite">
      <strong>{call.status.replace(/[-_]/g, " ")}</strong>
      {call.message && <p>{call.message}</p>}
      <AssistantLine assistant={call.assistant} notice={call.notice} patient={finished(call.status) ? undefined : call.demoPatient} />
      {call.appointmentBooked && <p>Pharmacist appointment: {call.appointmentBooked}</p>}
      {call.refillRequested && <p>Seven-day demo refill requested.</p>}
      {updatedAt && Number.isFinite(updatedAt.valueOf()) && <small>Updated <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleTimeString()}</time></small>}
      {!finished(call.status) && call.demoCode && <p className="presenter-code">Demo verification code <b>{call.demoCode}</b></p>}
    </div>}
    {error && <p role="alert" className="presenter-error">{error}</p>}
  </section>;
}

const scenarios = [
  { id: "greeting_slang_recovery", name: "Greetings and slang" },
  { id: "sam_ordinary_refill", name: "Ordinary refill" },
  { id: "corrected_consultation_time", name: "Corrected appointment time" },
];

type ScenarioState = {
  phase: "Ready" | "Queued" | "Running" | "Passed" | "Failed" | "Interrupted";
  events: TestEvent[];
};
const phaseTone = (phase: ScenarioState["phase"]): "neutral" | "quick" | "accent" | "stop" => {
  if (phase === "Passed") return "accent";
  if (phase === "Failed" || phase === "Interrupted") return "stop";
  if (phase === "Queued" || phase === "Running") return "quick";
  return "neutral";
};
const makeRows = (phase: ScenarioState["phase"]): ScenarioState[] => scenarios.map(() => ({ phase, events: [] }));

function EventLine({ event }: { event: TestEvent }) {
  if (event.type === "action") return <>Action · {event.label}</>;
  if (event.type === "check") return <>{event.passed ? "Passed" : "Failed"} · {event.label}</>;
  if (event.type === "line") return <><b>{event.speaker === "caller" ? "Caller" : "Pharmacy"}</b> · {event.text}</>;
  if (event.type === "error") return <>{event.message}</>;
  if (event.type === "verdict") return <>Verdict · {event.passed ? "Passed" : "Failed"} · {event.caught} caught · {event.broken} rules broken</>;
  return <>Test started</>;
}

/** Hear the suite: the caller and the pharmacy in two voices, a tone for a replaced line. */
function SuiteAudio({ player, live, setLive, muted, setMuted }: { player: CallPlayback; live: boolean; setLive: (on: boolean) => void; muted: boolean; setMuted: (on: boolean) => void }) {
  const state = useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  const active = ["playing", "waiting", "loading"].includes(state.mode);
  const words = state.problem || ({ playing: "Playing the call", waiting: "Waiting for the next line", loading: "Loading the next line", paused: "Paused", done: "Finished", idle: "", error: "", blocked: "" } as const)[state.mode];
  return <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Call audio">
    <button type="button" aria-pressed={live} onClick={() => setLive(!live)} className={chipClass(live, "cursor-pointer")}>Hear calls live</button>
    <button type="button" aria-pressed={muted} onClick={() => setMuted(!muted)} className={chipClass(muted, "cursor-pointer")}>{muted ? "Muted" : "Mute"}</button>
    {active && <Button size="sm" variant="secondary" onClick={() => player.pause()}>Pause audio</Button>}
    {(state.mode === "paused" || state.mode === "blocked" || state.mode === "error") && <Button size="sm" variant="secondary" onClick={() => player.play()}>{state.mode === "blocked" ? "Enable sound" : "Resume audio"}</Button>}
    <span role="status" className="text-xs text-ink-2">{words}</span>
    <span className="w-full text-xs text-ink-3">Caller and pharmacy in two ElevenLabs voices. A line the guard replaced plays a short tone, then what was said instead; the blocked text is never voiced.</span>
  </div>;
}

export function SuiteControl() {
  const [rows, setRows] = useState<ScenarioState[]>(() => makeRows("Ready"));
  const [running, setRunning] = useState(false);
  const [ended, setEnded] = useState(false);
  const [live, setLive] = useState(true);
  const [muted, setMutedState] = useState(false);
  const [player, setPlayer] = useState(() => new CallPlayback());
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => player.dispose(), [player]);
  const setMuted = (on: boolean) => { setMutedState(on); player.mute(on); };

  /** Replay one finished call with the same player. */
  function replay(events: TestEvent[]) {
    player.stop();
    const again = new CallPlayback(clipsFromEvents(events), true);
    again.mute(muted);
    setPlayer(again);
    again.play();
  }

  async function run() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRows(makeRows("Queued"));
    setRunning(true);
    setEnded(false);
    player.stop();
    const playback = new CallPlayback();
    playback.mute(muted);
    setPlayer(playback);
    // The click is the user's gesture, so the browser allows sound from here on.
    if (live) playback.play();
    try {
      for (const [index, scenario] of scenarios.entries()) {
        if (controller.signal.aborted) break;
        function update(phase: ScenarioState["phase"], event?: TestEvent) {
          setRows(previous => previous.map((row, i) => index === i ? { phase, events: event ? [...row.events, event] : row.events } : row));
        }
        update("Running");
        try {
          const response = await requestTest("live", scenario.id, controller.signal);
          await readTestEvents(response, event => {
            if (controller.signal.aborted) return;
            for (const clip of clipsFor(event)) playback.append(clip);
            const phase = event.type === "verdict" ? (event.passed ? "Passed" : "Failed") : event.type === "error" ? "Interrupted" : "Running";
            update(phase, event);
          });
        } catch (e) {
          if (!controller.signal.aborted) update("Interrupted", { type: "error", message: describe(e) });
        }
      }
    } finally {
      request.current = null;
      playback.finish();
      if (!controller.signal.aborted) { setRunning(false); setEnded(true); }
    }
  }

  return <section id="suite" className="presenter-card" aria-labelledby="suite-heading" aria-busy={running}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="suite-heading">Scripted call suite</h2>
        <p>Runs three synthetic patient calls in order through the pharmacy workflow.</p>
      </div>
      <Badge tone={running ? "quick" : ended ? (rows.some(row => row.phase === "Failed" || row.phase === "Interrupted") ? "stop" : "accent") : "neutral"} dot>
        {running ? "Running" : ended ? "Finished" : "Ready"}
      </Badge>
    </div>

    <div className="mt-4 rounded-card border border-line bg-sunken/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Configured tests</p>
      <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        {scenarios.map(({ id, name }) => <li key={id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-ink">{name}</span>
          <code className="font-mono text-[11px] text-ink-3">{id}</code>
        </li>)}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Synthetic test data · three calls · results stream below and are not a saved release-gate run.</p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button onClick={run} disabled={running} aria-busy={running}>
        {running ? "Running suite…" : "Run scripted suite"}
      </Button>
      <p className="text-sm text-ink-2" role="status" aria-live="polite">
        {running ? "Each call runs in sequence; this control is disabled until the run finishes." : ended ? `Finished · ${rows.filter(r => r.phase === "Passed").length} passed · ${rows.filter(r => r.phase === "Failed").length} failed · ${rows.filter(r => r.phase === "Interrupted").length} interrupted` : "Ready to run the three configured calls."}
      </p>
    </div>

    <SuiteAudio player={player} live={live} setLive={setLive} muted={muted} setMuted={setMuted} />

    <h3 className="mt-6 text-sm font-semibold text-ink">Live results</h3>
    <ol className="presenter-tests">{scenarios.map(({ id, name }, index) => {
      const row = rows[index];
      const last = row.events.at(-1);
      return <li key={id}>
        <div className="presenter-test-name"><strong>{name}</strong><Badge tone={phaseTone(row.phase)}>{row.phase}</Badge>
          {!running && row.events.some(e => e.type === "line") && <Button size="sm" variant="ghost" onClick={() => replay(row.events)}>Replay call</Button>}
        </div>
        {last && <p className="presenter-latest"><EventLine event={last} /></p>}
        {row.events.length > 1 && <details><summary>View call events ({row.events.length})</summary>
          <ul>{row.events.map((event, i) => <li key={i}><EventLine event={event} /></li>)}</ul>
        </details>}
      </li>;
    })}</ol>
  </section>;
}

interface WorkflowResults {
  passed: number;
  total: number;
  checks: { label: string; passed: boolean; detail: string }[];
}

export function WorkflowChecks() {
  const [results, setResults] = useState<WorkflowResults>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function run() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setResults(undefined);
    setError("");
    try {
      const response = await fetch("/api/presenter/checks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: "{}", cache: "no-store", signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "The workflow checks could not run.");
      if (!data || !Number.isInteger(data.passed) || !Number.isInteger(data.total) || !Array.isArray(data.checks) ||
          !data.checks.every((c: WorkflowResults["checks"][number]) => c && typeof c.label === "string" && typeof c.passed === "boolean" && typeof c.detail === "string")) {
        throw new Error("The workflow checks returned an incomplete result.");
      }
      if (!controller.signal.aborted) setResults(data);
    } catch (e) {
      if (!controller.signal.aborted) setError(describe(e));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  const checks = results ? [...results.checks].sort((a, b) => Number(a.passed) - Number(b.passed)) : [];

  return <section className="presenter-card presenter-workflow" aria-labelledby="workflow-heading" aria-busy={running}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="workflow-heading">Rule workflow checks</h2>
        <p>Checks the pharmacy rules against synthetic records. This is a separate run from the scripted call suite.</p>
      </div>
      <Badge tone={running ? "quick" : error ? "stop" : results ? (results.passed === results.total ? "accent" : "stop") : "neutral"} dot>
        {running ? "Running" : error ? "Unavailable" : results ? "Complete" : "Ready"}
      </Badge>
    </div>

    <div className="mt-4 rounded-card border border-line bg-sunken/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Configured checks</p>
      <p className="mt-2 text-sm text-ink">All available workflow rules · synthetic patient records</p>
      <p className="mt-1 text-xs text-ink-3">The API returns a fresh check result for this run; it does not replace or score the release gate.</p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button onClick={run} disabled={running} aria-busy={running}>
        {running ? "Checking workflows…" : "Run workflow checks"}
      </Button>
      {running && <p className="text-sm text-ink-2" role="status" aria-live="polite">Checking the configured synthetic workflows…</p>}
    </div>
    {error && <p role="alert" className="presenter-error">Could not load workflow results: {error}</p>}
    {results ? (
      <>
        <p className="presenter-total" role="status" aria-live="polite">{results.passed} of {results.total} workflow checks passed in this run.</p>
        <ul className="presenter-tests">{checks.map((check, index) => <li key={`${check.label}-${index}`}>
          <div className="presenter-test-name"><strong>{check.label}</strong><Badge tone={check.passed ? "accent" : "stop"}>{check.passed ? "Passed" : "Failed"}</Badge></div>
          <p className="presenter-latest">{check.detail}</p>
        </li>)}</ul>
      </>
    ) : !running && !error ? (
      <p className="mt-4 text-sm text-ink-3" role="status">No workflow check result yet. Run the checks to see their outcomes.</p>
    ) : null}
  </section>;
}
