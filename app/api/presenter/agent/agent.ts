import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Pool } from "pg";
import { createAgentDriver, createClaudeModel, type AgentModel } from "@/lib/agent";
import type { AgentEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, PHARMACY_NAME, SEED } from "@/lib/seed";
import { createPostgresStore, fromPgPool, poolConfig, type PostgresStore } from "@/lib/store/postgres";
import { demoCode } from "../phone/config";

// The hosted presenter calls, phone and browser, run the real agent (Trail #70): the same
// AgentDriver, control.press and guardSentence as every other call, on the Messages API.
//
// Vercel functions share no memory, so nothing about a call is kept in-process between turns:
//   * the record, calls, codes and orders live in a Postgres store in its own schema
//     (aegis_presenter_agent), never the shared demo tables;
//   * the driver's per-call state (the model's conversation, notes, held refill...) is exported
//     after each turn and saved with the presenter call's row, and the next turn, on whatever
//     instance serves it, imports it first.
// If the model errors or is too slow, AgentUnavailable lets the caller switch to the scripted
// menu. Caps: model turns per call, and model turns per hour across every presenter call.

export const AGENT_SCHEMA = "aegis_presenter_agent";
/** Said after the outbound opener: the demo's "phone on file" is the presenter's screen. */
export const CODE_ON_SCREEN = "Your code is on the screen in front of you.";
/** Said, through the guard, when a call has used its model turns. */
export const TURN_CAP_LINE = "This demo call has reached its limit. Thanks for trying Aegis. Goodbye.";
const SAY_AGAIN = "Sorry, could you say that again?";

const DEFAULT_MODEL = "claude-haiku-5-5"; // Twilio waits at most 15 s for a turn
const MAX_STEPS = 4; // model steps per caller line, for the same reason
const TURNS_PER_CALL = 12;
const TURNS_PER_HOUR = 120;
const IDLE_MS = 90_000; // no presenter agent turn for this long: nobody is mid-call

export class AgentUnavailable extends Error {}

/** What the presenter call's row keeps between turns. */
export type AgentState = { callId: string; snapshot: unknown; turns: number };
export type AgentReply = { agent: AgentState; reply: string; ended: boolean; verified: boolean; refillRequested: boolean };

// Connection caches only: correctness never depends on them surviving between requests.
const holder: { pool?: Pool; store?: Promise<PostgresStore>; model?: () => AgentModel } = {};

const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

function pool(): Pool {
  const url = process.env.AEGIS_DEMO_STORAGE_URL;
  if (!url) throw new AgentUnavailable("Missing demo database");
  if (!holder.pool) {
    const caFile = join(/* turbopackIgnore: true */ process.cwd(), "certs", "tiger-cloud-ca.pem");
    const ca = existsSync(caFile) ? [...rootCertificates, readFileSync(caFile, "utf8")].join("\n") : undefined;
    holder.pool = new Pool({
      ...poolConfig(url, ca),
      // Every connection works in the agent's own schema, so its rg_* tables can't be the shared demo's.
      options: `-c search_path=${AGENT_SCHEMA}`,
      max: 3,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    holder.pool.on("error", () => console.warn("The presenter agent database dropped an idle connection."));
  }
  return holder.pool;
}

async function agentStore(): Promise<PostgresStore> {
  holder.store ??= (async () => {
    const db = pool();
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${AGENT_SCHEMA}`);
    // Fail closed: if search_path didn't take, stop before the store creates or resets any table.
    const { rows } = await db.query<{ schema: string | null }>("select current_schema() as schema");
    if (rows[0]?.schema !== AGENT_SCHEMA) throw new Error(`The presenter agent runs only in schema ${AGENT_SCHEMA}`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${AGENT_SCHEMA}.aegis_agent_turns (at timestamptz NOT NULL DEFAULT now(), presenter_id uuid NOT NULL, kind text NOT NULL)`);
    return createPostgresStore(fromPgPool(db), SEED);
  })().catch((error) => {
    holder.store = undefined;
    throw error;
  });
  return holder.store;
}

/** Throws AgentUnavailable once the hour's model turns are spent; otherwise notes this one. */
async function takeTurn(presenterId: string, kind: "open" | "turn"): Promise<void> {
  const { rows } = await pool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${AGENT_SCHEMA}.aegis_agent_turns WHERE kind = 'turn' AND at > now() - interval '1 hour'`,
  );
  if ((rows[0]?.n ?? 0) >= limit("AEGIS_AGENT_TURNS_PER_HOUR", TURNS_PER_HOUR)) throw new AgentUnavailable("The demo's hourly model turns are spent");
  await pool().query(`INSERT INTO ${AGENT_SCHEMA}.aegis_agent_turns (presenter_id, kind) VALUES ($1, $2)`, [presenterId, kind]);
}

/** A fresh demo record when nobody is mid-call, so earlier demos' refills and calls don't trip the rules. */
async function resetIfIdle(store: PostgresStore): Promise<void> {
  const { rows } = await pool().query<{ last: Date | null }>(`SELECT max(at) AS last FROM ${AGENT_SCHEMA}.aegis_agent_turns`);
  const last = rows[0]?.last;
  if (!last || Date.now() - new Date(last).getTime() > IDLE_MS) await store.reset(SEED);
}

/** One request's parts, built fresh: nothing here outlives the request. */
async function parts(presenterId: string) {
  const store = await agentStore();
  const control = createControl({ store, makeCode: () => demoCode(presenterId), callIdPrefix: `p${presenterId.slice(0, 8)}_` });
  const base = holder.model?.() ?? createClaudeModel({ model: process.env.AGENT_MODEL || DEFAULT_MODEL, effort: "low", maxTokens: 2048 });
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
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: PHARMACY_NAME,
    maxSteps: MAX_STEPS,
  });
  return { store, control, driver, modelFailed: () => failed };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** Only what guardSentence let through: the driver's "line" events. */
const spoken = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "line" ? [e.text] : [])).join(" ").trim();

const verifiedIn = (snapshot: unknown) => (snapshot as { verified?: boolean } | undefined)?.verified === true;

async function refillRequested(store: PostgresStore, callId: string): Promise<boolean> {
  return (await store.listRecord(callId)).some((e) => e.button === "request_refill" && e.decision === "allowed");
}

/**
 * Start the agent's side of a presenter call: an outbound call to Sam (the demo patient) through
 * rule 7, the driver's fixed opener, the code sent "to the phone on file" (the presenter's
 * screen shows it), all through the guard.
 */
export async function openAgent(presenterId: string): Promise<AgentReply> {
  const { store, control, driver } = await parts(presenterId);
  await resetIfIdle(store);
  await takeTurn(presenterId, "open");
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new AgentUnavailable(`The rules won't ring the demo patient (rule ${started.ruleIds.join(", ")})`);
  const patient = await store.getPatient(IDS.sam);
  driver.joinCall(started.callId, { direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: patient ? `${patient.firstName} ${patient.lastName}` : undefined });
  const events = [...(await collect(driver.opening(started.callId))), ...(await collect(driver.speakLine(started.callId, CODE_ON_SCREEN)))];
  return { agent: { callId: started.callId, snapshot: driver.exportCall(started.callId), turns: 0 }, reply: spoken(events), ended: false, verified: false, refillRequested: false };
}

/** One caller line through the real agent, on whatever instance this is. */
export async function agentTurn(presenterId: string, agent: AgentState, text: string, { timeoutMs }: { timeoutMs: number }): Promise<AgentReply> {
  const { store, driver, modelFailed } = await parts(presenterId);
  driver.importCall(agent.callId, agent.snapshot);
  const finish = async (events: AgentEvent[], turns: number): Promise<AgentReply> => {
    const ended = events.some((e) => e.type === "ended") || (await store.getCall(agent.callId))?.state === "ended";
    let reply = spoken(events);
    if (!reply && !ended) reply = spoken(await collect(driver.speakLine(agent.callId, SAY_AGAIN)));
    const snapshot = ended ? undefined : driver.exportCall(agent.callId);
    return { agent: { callId: agent.callId, snapshot, turns }, reply, ended, verified: verifiedIn(snapshot ?? agent.snapshot), refillRequested: await refillRequested(store, agent.callId) };
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
    // Timing only, never what was said: Vercel's logs show how long each agent turn takes.
    console.log(`presenter agent: turn ${agent.turns + 1} took ${Date.now() - began} ms`);
    return await finish(events, agent.turns + 1);
  } finally {
    clearTimeout(timer);
  }
}

/** Test hooks. */
export function setAgentModelForTests(factory?: () => AgentModel): void {
  holder.model = factory;
}
export const agentStoreForTests = agentStore;

/** The real agent runs when the server has a Claude API key (a test model counts), unless AEGIS_PRESENTER_AGENT=off. */
export function agentEnabled(): boolean {
  if (process.env.AEGIS_PRESENTER_AGENT === "off") return false;
  return Boolean(holder.model || process.env.ANTHROPIC_API_KEY);
}

/** The caller said nothing: the driver's own check-in line, through the guard. No model turn. */
export async function agentSilence(presenterId: string, agent: AgentState): Promise<AgentReply> {
  const { store, driver } = await parts(presenterId);
  driver.importCall(agent.callId, agent.snapshot);
  const reply = spoken(await collect(driver.checkIn(agent.callId)));
  const snapshot = driver.exportCall(agent.callId);
  return { agent: { ...agent, snapshot }, reply, ended: false, verified: verifiedIn(snapshot), refillRequested: await refillRequested(store, agent.callId) };
}

/** The demo patient the agent calls, for the presenter's screen until they're verified. */
export const DEMO_PATIENT = (() => {
  const sam = SEED.patients.find((p) => p.id === IDS.sam)!;
  return { name: `${sam.firstName} ${sam.lastName}`, dob: sam.dob };
})();
