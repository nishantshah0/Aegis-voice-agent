import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { poolConfig } from "@/lib/store/postgres";
import { first, type Flow } from "./flow";

export type State =
  | "starting"
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled"
  | "unconfirmed";
export type PhoneRow = {
  id: string;
  sid?: string;
  status: State;
  flow: Flow;
  step: number;
  provider_error?: string;
  updated_at: Date;
  created_at: Date;
};
const active: State[] = ["starting", "queued", "ringing", "in-progress", "unconfirmed"];
export function isActive(s: State) {
  return active.includes(s);
}
let pool: Pool | undefined;
let setup: Promise<unknown> | undefined;
function db() {
  const url = process.env.AEGIS_DEMO_STORAGE_URL;
  if (!url) throw new Error("Missing demo database");
  if (!pool) {
    const caFile = join(/* turbopackIgnore: true */ process.cwd(), "certs", "tiger-cloud-ca.pem");
    const ca = existsSync(caFile)
      ? [...rootCertificates, readFileSync(caFile, "utf8")].join("\n")
      : undefined;
    pool = new Pool({
      ...poolConfig(url, ca),
      max: 3,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.warn("The presenter phone database dropped an idle connection."));
  }
  return pool;
}
async function ready() {
  await (setup ??= transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(739207102)");
    await client.query(`CREATE TABLE IF NOT EXISTS aegis_presenter_calls (
      id uuid PRIMARY KEY, request_key uuid UNIQUE NOT NULL, sid text UNIQUE, status text NOT NULL,
      flow jsonb NOT NULL, step integer NOT NULL DEFAULT 0, provider_error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(
      "CREATE TABLE IF NOT EXISTS aegis_presenter_audio (key text PRIMARY KEY, audio bytea NOT NULL)",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS aegis_presenter_requests (request_key uuid PRIMARY KEY, call_id uuid REFERENCES aegis_presenter_calls(id) NOT NULL)",
    );
  }).catch((error) => {
    setup = undefined;
    throw error;
  }));
}
async function atomic<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  return transaction(fn);
}
async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function reserve(requestKey: string) {
  return atomic(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(739207103)");
    const repeated = await c.query<PhoneRow>(
      "SELECT c.* FROM aegis_presenter_calls c WHERE c.request_key=$1 OR c.id=(SELECT call_id FROM aegis_presenter_requests WHERE request_key=$1)",
      [requestKey],
    );
    if (repeated.rows[0]) return { row: repeated.rows[0], dial: false };
    const running = await c.query<PhoneRow>(
      "SELECT * FROM aegis_presenter_calls WHERE status=ANY($1) AND created_at > now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1",
      [active],
    );
    if (running.rows[0]) {
      await c.query("INSERT INTO aegis_presenter_requests(request_key,call_id) VALUES($1,$2)", [
        requestKey,
        running.rows[0].id,
      ]);
      return { row: running.rows[0], dial: false };
    }
    const recent = await c.query(
      "SELECT count(*)::int AS n FROM aegis_presenter_calls WHERE created_at > now()-interval '1 hour'",
    );
    if (recent.rows[0].n >= 6) return undefined;
    const saved = await c.query<PhoneRow>(
      "INSERT INTO aegis_presenter_calls(id,request_key,status,flow) VALUES($1,$2,'starting',$3) RETURNING *",
      [randomUUID(), requestKey, first],
    );
    return { row: saved.rows[0], dial: true };
  });
}
export async function getCall(id: string) {
  await ready();
  return (await db().query<PhoneRow>("SELECT * FROM aegis_presenter_calls WHERE id=$1", [id])).rows[0];
}
export async function updateState(id: string, sid: string | undefined, next: State, reason?: string) {
  return atomic(async (c) => {
    const row = (await c.query<PhoneRow>("SELECT * FROM aegis_presenter_calls WHERE id=$1 FOR UPDATE", [id]))
      .rows[0];
    if (!row || (sid && row.sid && row.sid !== sid)) return;
    const rank: Partial<Record<State, number>> = {
      starting: 0,
      unconfirmed: 0,
      queued: 1,
      ringing: 2,
      "in-progress": 3,
    };
    if (!isActive(row.status) || (rank[next] ?? 4) < (rank[row.status] ?? 0)) return row;
    return (
      await c.query<PhoneRow>(
        "UPDATE aegis_presenter_calls SET status=$2,sid=COALESCE(sid,$3),provider_error=COALESCE($4,provider_error),updated_at=now() WHERE id=$1 RETURNING *",
        [id, next, sid, reason],
      )
    ).rows[0];
  });
}
export async function turn(id: string, sid: string, step: number, advance: (state: Flow) => Promise<Flow>) {
  return atomic(async (c) => {
    const row = (await c.query<PhoneRow>("SELECT * FROM aegis_presenter_calls WHERE id=$1 FOR UPDATE", [id]))
      .rows[0];
    if (
      !row ||
      Date.now() - new Date(row.created_at).getTime() > 300_000 ||
      (row.sid && row.sid !== sid) ||
      !isActive(row.status) ||
      step > row.step + 1
    )
      return;
    if (step <= row.step) return row;
    const flow =
      step >= 12
        ? { ...row.flow, phase: "end", reply: "The demo has reached its call limit. Goodbye." }
        : await advance(row.flow);
    return (
      await c.query<PhoneRow>(
        "UPDATE aegis_presenter_calls SET step=$2,flow=$3,sid=COALESCE(sid,$4),status='in-progress',updated_at=now() WHERE id=$1 RETURNING *",
        [id, step, flow, sid],
      )
    ).rows[0];
  });
}
/** Trail #70: the call's first flow (the agent's opener), set once before Twilio dials. */
export async function setFirstFlow(id: string, flow: Flow) {
  return atomic(async (c) => (await c.query<PhoneRow>("UPDATE aegis_presenter_calls SET flow=$2,updated_at=now() WHERE id=$1 AND step=0 RETURNING *", [id, flow])).rows[0]);
}
export async function getAudio(key: string): Promise<Buffer | undefined> {
  await ready();
  return (await db().query("SELECT audio FROM aegis_presenter_audio WHERE key=$1", [key])).rows[0]?.audio;
}
export async function saveAudio(key: string, audio: Buffer) {
  await ready();
  await db().query("INSERT INTO aegis_presenter_audio(key,audio) VALUES($1,$2) ON CONFLICT DO NOTHING", [
    key,
    audio,
  ]);
}
