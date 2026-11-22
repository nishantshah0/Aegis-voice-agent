import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Pool } from "pg";
import { poolConfig } from "@/lib/store/postgres";
import { first, type Flow } from "../phone/flow";

export type BrowserTurn = {
  session_id: string;
  turn_id: string;
  step: number;
  flow: Flow;
  expires_at: Date;
};

let pool: Pool | undefined;
let setup: Promise<unknown> | undefined;

async function database() {
  if (!pool) {
    const url = process.env.AEGIS_DEMO_STORAGE_URL;
    if (!url) throw new Error("Missing presenter database");
    const cert = join(/* turbopackIgnore: true */ process.cwd(), "certs", "tiger-cloud-ca.pem");
    const ca = existsSync(cert) ? [...rootCertificates, readFileSync(cert, "utf8")].join("\n") : undefined;
    pool = new Pool({
      ...poolConfig(url, ca),
      max: 2,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.warn("The browser demo database dropped an idle connection."));
  }
  const db = pool;
  // Serialize first-time DDL across serverless instances, including concurrent cold starts.
  setup ??= (async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(739207104)");
      await client.query(`CREATE TABLE IF NOT EXISTS aegis_presenter_browser_turns (
        session_id uuid NOT NULL, step integer NOT NULL, turn_id uuid NOT NULL, flow jsonb NOT NULL,
        expires_at timestamptz NOT NULL, PRIMARY KEY (session_id, step), UNIQUE (session_id, turn_id))`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    setup = undefined;
    throw error;
  });
  await setup;
  return db;
}

export async function openSession(sessionId: string = randomUUID(), flow: Flow = first) {
  const db = await database();
  await db.query("DELETE FROM aegis_presenter_browser_turns WHERE expires_at <= now()");
  const result = await db.query<BrowserTurn>(
    `INSERT INTO aegis_presenter_browser_turns (session_id, step, turn_id, flow, expires_at)
     VALUES ($1,0,$2,$3,now() + interval '15 minutes') RETURNING *`,
    [sessionId, randomUUID(), flow],
  );
  return result.rows[0];
}

export async function findTurn(sessionId: string, turnId: string) {
  const db = await database();
  const result = await db.query<BrowserTurn>(
    "SELECT * FROM aegis_presenter_browser_turns WHERE session_id=$1 AND turn_id=$2 AND expires_at > now()",
    [sessionId, turnId],
  );
  return result.rows[0];
}

export async function latestTurn(sessionId: string): Promise<BrowserTurn | undefined> {
  const db = await database();
  const result = await db.query<BrowserTurn>(
    "SELECT * FROM aegis_presenter_browser_turns WHERE session_id=$1 AND expires_at > now() ORDER BY step DESC LIMIT 1",
    [sessionId],
  );
  return result.rows[0];
}

// A unique step is the compare-and-swap. Concurrent inputs cannot both advance the same prior state.
// Only the synthetic reducer result is stored. Caller text and microphone data are transient.
export async function appendTurn(previous: BrowserTurn, turnId: string, flow: Flow) {
  const db = await database();
  const result = await db.query<BrowserTurn>(
    `INSERT INTO aegis_presenter_browser_turns (session_id, step, turn_id, flow, expires_at)
     SELECT session_id, step+1, $3, $4, expires_at FROM aegis_presenter_browser_turns
     WHERE session_id=$1 AND step=$2 AND expires_at > now()
     ON CONFLICT DO NOTHING RETURNING *`,
    [previous.session_id, previous.step, turnId, flow],
  );
  return result.rows[0];
}
