import { randomUUID } from "node:crypto";
import { constants, existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Pool } from "pg";
import { z } from "zod";
import { fromPgPool, poolConfig, type SqlDb } from "@/lib/store/postgres";
import { liveResultsDirectory, redactPublicText, type DemoScenarioId } from "./public-record";

const caption = z.string().trim().min(1).max(256);
const count = z.number().int().nonnegative();
const savedEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("start"), scenarioId: z.string() }),
  z.strictObject({ type: z.literal("line"), speaker: z.enum(["caller", "pharmacy"]), text: z.string().trim().min(1).max(4096) }),
  z.strictObject({ type: z.literal("action"), label: caption }),
  z.strictObject({ type: z.literal("check"), label: caption, passed: z.boolean() }),
  z.strictObject({ type: z.literal("verdict"), passed: z.boolean(), caught: count, broken: count }),
]);
const savedRun = z.strictObject({ scenarioId: z.string(), model: caption, at: z.iso.datetime(), events: z.array(savedEvent).min(4).max(1000) });
type SavedRun = z.infer<typeof savedRun>;
const runName = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\.json$/i;

function completed(raw: unknown, id: DemoScenarioId): SavedRun | undefined {
  const parsed = savedRun.safeParse(raw);
  if (!parsed.success || parsed.data.scenarioId !== id) return;
  const { events } = parsed.data;
  const start = events[0], verdict = events.at(-1);
  if (start.type !== "start" || start.scenarioId !== id || verdict?.type !== "verdict") return;
  const dialogue = events.slice(1, -1);
  const checks = dialogue.filter(e => e.type === "check");
  if (!checks.length || !dialogue.some(e => e.type === "line") || dialogue.some(e => e.type === "start" || e.type === "verdict")) return;
  if (checks.every(check => check.passed) !== verdict.passed) return;
  let identityPhase = id !== "greeting_slang_recovery" && id !== "family_callback";
  for (const event of events) {
    if (event.type === "action" && event.label === "Verified caller identity") identityPhase = false;
    if (event.type === "line") event.text = redactPublicText(event.text, event.speaker === "caller", identityPhase);
  }
  return parsed.data;
}

async function latestFile(id: DemoScenarioId) {
  const dir = liveResultsDirectory();
  const info = await lstat(/* turbopackIgnore: true */ dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!info?.isDirectory()) return;
  let latest: SavedRun | undefined;
  for (const entry of await readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true })) {
    if (!entry.isFile() || !runName.test(entry.name)) continue;
    // No links, devices, raw attempt files, or .pending writes, even if renamed during listing.
    const file = await open(join(/* turbopackIgnore: true */ dir, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
    if (!file) continue;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      const raw = await file.readFile("utf8");
      const candidate = completed(JSON.parse(raw), id);
      if (candidate && (!latest || Date.parse(candidate.at) > Date.parse(latest.at))) latest = candidate;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    } finally {
      await file.close();
    }
  }
  return latest;
}


type Archive = {
  save(id: DemoScenarioId, raw: unknown, signal?: AbortSignal): Promise<void>;
  latest(id: DemoScenarioId): Promise<SavedRun | undefined>;
};

function serialize(id: DemoScenarioId, raw: unknown) {
  const run = completed(raw, id);
  if (!run) throw new Error("The synthetic test is incomplete or contains unexpected fields.");
  const payload = JSON.stringify(run);
  if (Buffer.byteLength(payload) > 512 * 1024) throw new Error("The synthetic test is too large to archive.");
  return { run, payload };
}

const local: Archive = {
  latest: latestFile,
  async save(id, raw, signal) {
    const { payload } = serialize(id, raw);
    const dir = liveResultsDirectory();
    await mkdir(dir, { recursive: true });
    const target = join(/* turbopackIgnore: true */ dir, randomUUID() + ".json");
    const pending = target + ".pending";
    try {
      await writeFile(/* turbopackIgnore: true */ pending, payload + "\n", { flag: "wx", signal });
      signal?.throwIfAborted();
      await rename(/* turbopackIgnore: true */ pending, /* turbopackIgnore: true */ target);
    } finally { await rm(/* turbopackIgnore: true */ pending, { force: true }); }
  },
};

// This namespace never initializes the application's patient or pharmacy store.
export function postgresArchive(db: SqlDb): Archive {
  let initialized: Promise<void> | undefined;
  function ensureTable() {
    initialized ??= db.transaction(async query => {
      // A pre-provisioned table only needs SELECT/INSERT for this login.
      const existing = await query<{ table_name: string | null }>(
        "select to_regclass('aegis_demo.aegis_presenter_runs')::text as table_name",
      );
      if (existing.rows[0]?.table_name) return;
      // Serialize the first DDL across independently cold-started functions.
      await query("select pg_advisory_xact_lock(hashtext('aegis_presenter_runs_v1'))");
      await query(`create table if not exists aegis_demo.aegis_presenter_runs (
        scenario_id text not null, completed_at timestamptz not null, run_id uuid not null,
        payload jsonb not null, primary key (scenario_id, completed_at, run_id)
      )`);
    }).catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  return {
    async save(id, raw, signal) {
      const { run, payload } = serialize(id, raw);
      signal?.throwIfAborted();
      await ensureTable();
      signal?.throwIfAborted();
      await db.query(`insert into aegis_demo.aegis_presenter_runs (scenario_id, completed_at, run_id, payload)
        values ($1, $2, $3, $4::jsonb)`, [id, run.at, randomUUID(), payload]);
    },
    async latest(id) {
      try {
        const { rows } = await db.query<{ payload: unknown }>(`select payload from aegis_demo.aegis_presenter_runs
          where scenario_id = $1 order by completed_at desc, run_id desc limit 1`, [id]);
        if (!rows.length) return;
        const run = completed(rows[0].payload, id);
        if (!run) throw new Error("The saved synthetic run could not be validated.");
        return run;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "42P01") return; // Before the first completed run.
        throw error;
      }
    },
  };
}

let archiveConnection: { url: string; pool: Pool; archive: Archive } | undefined;

export function demoArchive(): Archive {
  const url = process.env.AEGIS_DEMO_STORAGE_URL;
  if (!url) return local;
  if (archiveConnection?.url !== url) {
    const caFile = join(/* turbopackIgnore: true */ process.cwd(), "certs", "tiger-cloud-ca.pem");
    const ca = existsSync(caFile) ? [...rootCertificates, readFileSync(caFile, "utf8")].join("\n") : undefined;
    const pool = new Pool({
      ...poolConfig(url, ca), max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true, application_name: "aegis_presenter_archive",
    });
    pool.on("error", () => console.warn("The simulation archive dropped an idle connection."));
    if (archiveConnection) void archiveConnection.pool.end().catch(() => {});
    archiveConnection = { url, pool, archive: postgresArchive(fromPgPool(pool)) };
  }
  return archiveConnection.archive;
}
