// 2.7: the Postgres store on the real Tiger Data database. Never part of `npm test`: it runs
// only with LIVE_DB=1 and DATABASE_URL set, in its own schema (rg_test) so the app's tables
// are untouched, verifies the server with certs/tiger-cloud-ca.pem, and drops the schema after.
//   LIVE_DB=1 DATABASE_URL=… npx vitest run lib/store/postgres.live.test.ts
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Approver, Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "./memory";
import { createPostgresStore, fromPgPool, poolConfig } from "./postgres";

const live = process.env.LIVE_DB === "1" && Boolean(process.env.DATABASE_URL);
const SCHEMA = "rg_test";
const pharmacist: Approver = { id: "auth0|test-pharmacist", name: "Test Pharmacist", role: "pharmacist" };

async function samsCall(store: Store) {
  const control = createControl({ store, makeCode: () => "112358" });
  const guard = createSpeechGuard({ store });
  const safety = createSafetyCheck({ store });
  const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
  if (!started.ok) throw new Error("rule 7 refused Sam");
  const { callId, lookupId } = started;
  await guard(callId, "Hi, this is Maple Street Pharmacy calling for Sam.");
  await control.press(callId, "send_code", { lookup_id: lookupId });
  await safety(callId, "Sure, the code is 112358.");
  await control.press(callId, "check_code", { lookup_id: lookupId, code: "112358", dob: "1990-03-14" });
  await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });
  await guard(callId, "Your Concerta refill is approved.");
  await safety(callId, "I've had some mild headaches in the afternoon.");
  await control.press(callId, "note_for_pharmacist", { rx_id: IDS.samConcerta, text: "Mild afternoon headaches", kind: "side_effect" });
  const [item] = await store.queue();
  await store.decide(item.id, "approve", pharmacist);
  await control.endCall(callId);
  return store.listRecord();
}

describe.skipIf(!live)("Postgres store on Tiger Data (live)", () => {
  let pool: Pool;
  let store: Store;

  beforeAll(async () => {
    const ca = readFileSync(process.env.DATABASE_CA_FILE ?? "certs/tiger-cloud-ca.pem", "utf8");
    pool = new Pool({ ...poolConfig(process.env.DATABASE_URL!, ca), max: 3 });
    // Every connection uses rg_test before its first query (pg runs a client's queries in order),
    // so nothing here can touch the app's own tables.
    pool.on("connect", (client) => void client.query(`set search_path to ${SCHEMA}`));
    await pool.query(`create schema if not exists ${SCHEMA}`);
    const where = (await pool.query<{ s: string }>("select current_schema() as s")).rows[0].s;
    if (where !== SCHEMA) throw new Error(`refusing to run: current schema is ${where}`);
    store = createPostgresStore(fromPgPool(pool), SEED);
    await store.reset(SEED);
  }, 60_000);

  afterAll(async () => {
    await pool?.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool?.end();
  }, 60_000);

  it("serves the seed and keeps the clock", async () => {
    expect(await store.listPatients()).toEqual(SEED.patients);
    expect(await store.now()).toBe(SEED.now);
  }, 30_000);

  it("runs Sam's call on the real lock with the same record hashes as the memory store", async () => {
    await store.reset(SEED);
    const postgres = await samsCall(store);
    const memory = await samsCall(createMemoryStore(SEED));
    expect(findBrokenLink(postgres)).toBeNull();
    expect(postgres.map((e) => e.hash)).toEqual(memory.map((e) => e.hash));
  }, 60_000);
});
