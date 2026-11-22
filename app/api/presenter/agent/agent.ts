import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Pool } from "pg";
import { CALL_MODEL, SDK_DEV_MODEL, createAgentDriver, createAgentSdkModel, createClaudeModel, type AgentModel } from "@/lib/agent";
import type { AgentEvent, Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { emit } from "@/lib/events";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME, SEED } from "@/lib/seed";
import { poolConfig } from "@/lib/store/postgres";
import { getStore } from "../../_lib/runtime";
import { demoCode } from "../phone/config";

// The hosted presenter calls, phone and browser, run the real agent (Trail #70): the same
// AgentDriver, control.press and guardSentence as every other call, on the Messages API.
//
// Vercel functions share no memory, so nothing about a call is kept in-process between turns:
//   * the call, its record, codes, queue items and orders go to the same store the /app
//     dashboard reads (getStore(): DATABASE_URL), so the call shows in /app/pharmacy/calls and
//     Today like any other;
//   * the driver's conversation state is exported after each turn, sealed to its call (version
//     and call id), saved with the presenter call's row, and imported by the next instance.
// The snapshot grants nothing: verification, code tries, lanes, orders and approvals are the
// control layer's, read from the store. If the model errors or is too slow, AgentUnavailable
// lets the caller switch to the scripted menu. Caps: model turns per call, and per hour.

/** Said after the outbound opener: the demo's "phone on file" is the presenter's screen. */
export const CODE_ON_SCREEN = "Your code is on the screen in front of you.";
/** Said, through the guard, when a call has used its model turns. */
export const TURN_CAP_LINE = "This demo call has reached its limit. Thanks for trying Aegis. Goodbye.";
const SAY_AGAIN = "Sorry, could you say that again?";

export type Channel = "phone" | "browser";
type Effort = "low" | "medium" | "high";
// Twilio waits at most 15 s for a phone turn, voice included: start low there.
const EFFORT: Record<Channel, { env: string; fallback: Effort }> = {
  phone: { env: "AGENT_EFFORT_PHONE", fallback: "low" },
  browser: { env: "AGENT_EFFORT_BROWSER", fallback: "medium" },
};
const MAX_STEPS: Record<Channel, number> = { phone: 4, browser: 6 };
const TURNS_PER_CALL = 12;
const TURNS_PER_HOUR = 120;
const SNAPSHOT_VERSION = 1;

export class AgentUnavailable extends Error {}

/** What the presenter call's row keeps between turns. */
export type AgentState = { callId: string; snapshot: unknown; turns: number };
export type AgentReply = { agent: AgentState; reply: string; ended: boolean; verified: boolean; refillRequested: boolean };
export type ModelOptions = { channel: Channel; model: string; effort: Effort };

// Connection and test caches only: correctness never depends on them surviving between requests.
const holder: { pool?: Pool; model?: (options: ModelOptions) => AgentModel } = {};

const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** The presenter's own database, for the hourly turn count. */
function pool(): Pool {
  const url = process.env.AEGIS_DEMO_STORAGE_URL;
  if (!url) throw new AgentUnavailable("Missing demo database");
  if (!holder.pool) {
    const caFile = join(/* turbopackIgnore: true */ process.cwd(), "certs", "tiger-cloud-ca.pem");
    const ca = existsSync(caFile) ? [...rootCertificates, readFileSync(caFile, "utf8")].join("\n") : undefined;
    holder.pool = new Pool({ ...poolConfig(url, ca), max: 3, connectionTimeoutMillis: 6000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
    holder.pool.on("error", () => console.warn("The presenter agent database dropped an idle connection."));
  }
  return holder.pool;
}

/** Throws AgentUnavailable once the hour's model turns are spent; otherwise notes this one. */
async function takeTurn(presenterId: string, kind: "open" | "turn"): Promise<void> {
  const db = pool();
  await db.query("CREATE TABLE IF NOT EXISTS aegis_presenter_agent_turns (at timestamptz NOT NULL DEFAULT now(), presenter_id uuid NOT NULL, kind text NOT NULL)");
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM aegis_presenter_agent_turns WHERE kind = 'turn' AND at > now() - interval '1 hour'");
  if ((rows[0]?.n ?? 0) >= limit("AEGIS_AGENT_TURNS_PER_HOUR", TURNS_PER_HOUR)) throw new AgentUnavailable("The demo's hourly model turns are spent");
  await db.query("INSERT INTO aegis_presenter_agent_turns (presenter_id, kind) VALUES ($1, $2)", [presenterId, kind]);
}

/** The dashboard's store. On Vercel it must be Postgres: a memory store isn't shared between instances. */
function dashboardStore(): Store {
  if (process.env.VERCEL && !process.env.DATABASE_URL) throw new AgentUnavailable("DATABASE_URL is required on Vercel");
  return getStore();
}

function modelFor(channel: Channel): AgentModel {
  const effort = (process.env[EFFORT[channel].env] as Effort | undefined) || EFFORT[channel].fallback;
  const options: ModelOptions = { channel, model: process.env.AGENT_MODEL || CALL_MODEL, effort };
  if (holder.model) return holder.model(options);
  if (process.env.ANTHROPIC_API_KEY) return createClaudeModel({ model: options.model, effort, maxTokens: 4096 });
  // Local runs only (Claude Code signed in): the Agent SDK, as the /phone page uses.
  if (process.env.LIVE_AGENT === "1") return createAgentSdkModel({ model: process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL });
  throw new AgentUnavailable("No model configured");
}

/** One request's parts, built fresh: nothing here outlives the request. */
function parts(presenterId: string, channel: Channel) {
  const store = dashboardStore();
  const control = createControl({ store, emit, makeCode: () => demoCode(presenterId), callIdPrefix: `p${presenterId.slice(0, 8)}_` });
  const base = modelFor(channel);
  let failed = false;
  // The driver answers a model error itself (a handover line); this tells us it happened, so the
  // presenter call can fall back to the scripted menu instead.
  const model: AgentModel = {
    ...base,
    async *turn(request) {
      try {
        yield* base.turn(request);
      } catch (error) {
        failed = true;
        throw error;
      }
    },
  };
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store, emit }),
    checkCallerLine: createSafetyCheck({ store, emit }),
    model,
    pharmacyName: PHARMACY_NAME,
    emit,
    maxSteps: MAX_STEPS[channel],
  });
  return { store, control, driver, modelFailed: () => failed };
}

// ---------- The sealed snapshot ----------

/** The driver's conversation state, sealed to its call. */
function seal(callId: string, state: unknown) {
  return state === undefined ? undefined : { v: SNAPSHOT_VERSION, callId, state };
}

/** The state inside a sealed snapshot, or AgentUnavailable if it's another call's, another version, or malformed. */
function unseal(callId: string, sealed: unknown): unknown {
  const s = sealed as { v?: unknown; callId?: unknown; state?: { messages?: unknown; direction?: unknown } } | null;
  if (!s || typeof s !== "object" || s.v !== SNAPSHOT_VERSION || s.callId !== callId) throw new AgentUnavailable("The call's saved state doesn't match it");
  if (!s.state || typeof s.state !== "object" || !Array.isArray(s.state.messages) || typeof s.state.direction !== "string") {
    throw new AgentUnavailable("The call's saved state is malformed");
  }
  return s.state;
}

// ---------- Turns ----------

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** Only what guardSentence let through: the driver's "line" events. */
const spoken = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "line" ? [e.text] : [])).join(" ").trim();

/** Authority comes from the store and record, never from the snapshot. */
async function standing(store: Store, callId: string, wasVerified: boolean) {
  const call = await store.getCall(callId);
  const record = await store.listRecord(callId);
  return {
    verified: wasVerified || call?.state === "verified",
    ended: call?.state === "ended",
    refillRequested: record.some((e) => e.button === "request_refill" && e.decision === "allowed"),
  };
}

/**
 * Start the agent's side of a presenter call: an outbound call to Sam (the demo patient) through
 * rule 7, the driver's fixed opener, and the code sent "to the phone on file" (the presenter's
 * screen shows it), all through the guard.
 */
export async function openAgent(presenterId: string, channel: Channel): Promise<AgentReply> {
  const { store, control, driver } = parts(presenterId, channel);
  await takeTurn(presenterId, "open");
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new AgentUnavailable(`The rules won't ring the demo patient (rule ${started.ruleIds.join(", ")})`);
  const patient = await store.getPatient(IDS.sam);
  driver.joinCall(started.callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined });
  const events = [...(await collect(driver.opening(started.callId))), ...(await collect(driver.speakLine(started.callId, CODE_ON_SCREEN)))];
  return { agent: { callId: started.callId, snapshot: seal(started.callId, driver.exportCall(started.callId)), turns: 0 }, reply: spoken(events), ended: false, verified: false, refillRequested: false };
}

type TurnOptions = { channel: Channel; timeoutMs: number; wasVerified?: boolean };

/** One caller line through the real agent, on whatever instance this is. */
export async function agentTurn(presenterId: string, agent: AgentState, text: string, { channel, timeoutMs, wasVerified = false }: TurnOptions): Promise<AgentReply> {
  const state = unseal(agent.callId, agent.snapshot);
  const { store, driver, modelFailed } = parts(presenterId, channel);
  driver.importCall(agent.callId, state);
  const finish = async (events: AgentEvent[], turns: number): Promise<AgentReply> => {
    const now = await standing(store, agent.callId, wasVerified);
    const ended = now.ended || events.some((e) => e.type === "ended");
    let reply = spoken(events);
    if (!reply && !ended) reply = spoken(await collect(driver.speakLine(agent.callId, SAY_AGAIN)));
    return { agent: { callId: agent.callId, snapshot: ended ? undefined : seal(agent.callId, driver.exportCall(agent.callId)), turns }, reply, ended, verified: now.verified, refillRequested: now.refillRequested };
  };

  if (agent.turns >= limit("AEGIS_AGENT_TURNS_PER_CALL", TURNS_PER_CALL)) {
    const events = await collect(driver.speakLine(agent.callId, TURN_CAP_LINE));
    await driver.endCall(agent.callId);
    return { ...(await finish(events, agent.turns)), ended: true };
  }
  await takeTurn(presenterId, "turn");
  const began = Date.now();
  const run = collect(driver.callerSays(agent.callId, text.slice(0, 500)));
  run.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentUnavailable("The assistant took too long")), timeoutMs);
  });
  try {
    const events = await Promise.race([run, late]);
    if (modelFailed()) throw new AgentUnavailable("The assistant's model failed");
    // Timing only, never what was said: the logs show how long each agent turn takes.
    console.log(`presenter agent: ${channel} turn ${agent.turns + 1} took ${Date.now() - began} ms`);
    return await finish(events, agent.turns + 1);
  } finally {
    clearTimeout(timer);
  }
}

/** The caller said nothing: the driver's own check-in line, through the guard. No model turn. */
export async function agentSilence(presenterId: string, agent: AgentState, { channel, wasVerified = false }: { channel: Channel; wasVerified?: boolean }): Promise<AgentReply> {
  const state = unseal(agent.callId, agent.snapshot);
  const { store, driver } = parts(presenterId, channel);
  driver.importCall(agent.callId, state);
  const reply = spoken(await collect(driver.checkIn(agent.callId)));
  const now = await standing(store, agent.callId, wasVerified);
  return { agent: { ...agent, snapshot: seal(agent.callId, driver.exportCall(agent.callId)) }, reply, ended: false, verified: now.verified, refillRequested: now.refillRequested };
}

/** The real agent runs when the server has a model (a Claude API key; LIVE_AGENT=1 locally), unless AEGIS_PRESENTER_AGENT=off. */
export function agentEnabled(): boolean {
  if (process.env.AEGIS_PRESENTER_AGENT === "off") return false;
  return Boolean(holder.model || process.env.ANTHROPIC_API_KEY || process.env.LIVE_AGENT === "1");
}

/** The demo patient the agent calls, for the presenter's screen until they're verified. */
export const DEMO_PATIENT = (() => {
  const sam = SEED.patients.find((p) => p.id === IDS.sam)!;
  return { name: `${sam.firstName} ${sam.lastName}`, dob: sam.dob };
})();

/** Test hook. */
export function setAgentModelForTests(factory?: (options: ModelOptions) => AgentModel): void {
  holder.model = factory;
}
