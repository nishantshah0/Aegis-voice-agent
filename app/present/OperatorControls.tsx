"use client";

import { useEffect, useRef, useState } from "react";
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
const makeRows = (phase: ScenarioState["phase"]): ScenarioState[] => scenarios.map(() => ({ phase, events: [] }));

function EventLine({ event }: { event: TestEvent }) {
  if (event.type === "action") return <>Action · {event.label}</>;
  if (event.type === "check") return <>{event.passed ? "Passed" : "Failed"} · {event.label}</>;
  if (event.type === "line") return <><b>{event.speaker === "caller" ? "Caller" : "Pharmacy"}</b> · {event.text}</>;
  if (event.type === "error") return <>{event.message}</>;
  if (event.type === "verdict") return <>Verdict · {event.passed ? "Passed" : "Failed"} · {event.caught} caught · {event.broken} rules broken</>;
  return <>Test started</>;
}

export function SuiteControl() {
  const [rows, setRows] = useState<ScenarioState[]>(() => makeRows("Ready"));
  const [running, setRunning] = useState(false);
  const [ended, setEnded] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function run() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRows(makeRows("Queued"));
    setRunning(true);
    setEnded(false);
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
            const phase = event.type === "verdict" ? (event.passed ? "Passed" : "Failed") : event.type === "error" ? "Interrupted" : "Running";
            update(phase, event);
          });
        } catch (e) {
          if (!controller.signal.aborted) update("Interrupted", { type: "error", message: describe(e) });
        }
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) { setRunning(false); setEnded(true); }
    }
  }

  return <section id="suite" className="presenter-card" aria-labelledby="suite-heading">
    <h2 id="suite-heading">Business test suite</h2>
    <p>Run three live synthetic calls in sequence and see how the pharmacy handles each one.</p>
    <button type="button" className="presenter-primary" onClick={run} disabled={running}>{running ? "Suite running…" : "Run all 3 business tests"}</button>
    <ol className="presenter-tests">{scenarios.map(({ id, name }, index) => {
      const row = rows[index];
      const last = row.events.at(-1);
      return <li key={id}>
        <div className="presenter-test-name"><strong>{name}</strong><span className="presenter-phase" data-phase={row.phase} role="status">{row.phase}</span></div>
        {last && <p className="presenter-latest"><EventLine event={last} /></p>}
        {row.events.length > 1 && <details><summary>View call events ({row.events.length})</summary>
          <ul>{row.events.map((event, i) => <li key={i}><EventLine event={event} /></li>)}</ul>
        </details>}
      </li>;
    })}</ol>
    {ended && <p role="status" className="presenter-total">Suite complete · {rows.filter(r => r.phase === "Passed").length} passed · {rows.filter(r => r.phase === "Failed").length} failed · {rows.filter(r => r.phase === "Interrupted").length} interrupted</p>}
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

  return <section className="presenter-card presenter-workflow" aria-labelledby="workflow-heading">
    <h2 id="workflow-heading">Workflow checks</h2>
    <p>Check the pharmacy’s rules against synthetic records.</p>
    <button type="button" className="presenter-primary" onClick={run} disabled={running}>{running ? "Checking workflows…" : "Run workflow checks"}</button>
    {error && <p role="alert" className="presenter-error">{error}</p>}
    {results && <>
      <p className="presenter-total" role="status">{results.passed} of {results.total} workflow checks passed</p>
      <ul className="presenter-tests">{results.checks.map((check, index) => <li key={index}>
        <div className="presenter-test-name"><strong>{check.label}</strong><span className="presenter-phase" data-phase={check.passed ? "Passed" : "Failed"}>{check.passed ? "Passed" : "Failed"}</span></div>
        <p className="presenter-latest">{check.detail}</p>
      </li>)}</ul>
    </>}
  </section>;
}
