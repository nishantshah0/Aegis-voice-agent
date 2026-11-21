import { CALL_MODEL, SDK_DEV_MODEL, createAgentDriver, createAgentSdkModel, createClaudeModel } from "@/lib/agent";
import type { AgentModel } from "@/lib/agent";
import { createFakeDriver, createFakeGuard } from "@/lib/contract/fakes";
import type { AgentDriver, Store } from "@/lib/contract";
import { createControl, type Control } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { emit } from "@/lib/events";
import { PHARMACY_NAME, SEED } from "@/lib/seed";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { getStore as getMemoryStore } from "@/lib/store/memory";
import { createPostgresStore, fromPgPool, poolConfig } from "@/lib/store/postgres";
import { clearPhoneTokens } from "./phone";

// The parts the API routes run on, wired once per server.
// Store: see getStore() below (Tiger Data when DATABASE_URL is set, else the memory store).
// Control: Role 4's control layer (4.3) on that store. Every call starts through it (rule 7).
// Driver: see describeAgent() below. The real agent always runs with the real speech guard and
// safety check; the contract's fake never scores or shows a real result.

type Parts = { control: Control; driver: AgentDriver };

const holder = globalThis as typeof globalThis & { __refillGuardParts?: Parts };

// Store: Postgres on Tiger Data when DATABASE_URL is set (2.7), otherwise Role 4's memory store.
// Certificates are always verified: against DATABASE_CA_FILE, else certs/tiger-cloud-ca.pem
// (Timescale's root CA, checked with full hostname verification), else the system roots.
const TIGER_CA = "certs/tiger-cloud-ca.pem";
const pgHolder = globalThis as typeof globalThis & { __refillGuardPg?: { url: string; store: Store; pool: Pool } };

export function getStore(): Store {
  const url = process.env.DATABASE_URL;
  if (!url) return getMemoryStore();
  if (pgHolder.__refillGuardPg?.url !== url) {
    const caFile = process.env.DATABASE_CA_FILE ?? (existsSync(TIGER_CA) ? TIGER_CA : undefined);
    // Connections stay open between turns (a new TLS connection to Tiger Cloud costs ~350 ms,
    // and pg closes idle ones after 10 s by default). If the server drops an idle one, the pool
    // discards it and opens another; the error is logged rather than crashing the process.
    const pool = new Pool({ ...poolConfig(url, caFile ? readFileSync(caFile, "utf8") : undefined), max: 5, idleTimeoutMillis: 0, keepAlive: true });
    pool.on("error", (error) => console.warn(`store: idle Postgres connection dropped (${error.message})`));
    console.log(`store: Postgres (${new URL(url).hostname}), CA ${caFile ?? "system roots"}`);
    pgHolder.__refillGuardPg = { url, pool, store: createPostgresStore(fromPgPool(pool)) };
  }
  return pgHolder.__refillGuardPg.store;
}

function parts(): Parts {
  if (!holder.__refillGuardParts) {
    const store = getStore();
    // Codes never go on the event stream; the phone reads them from GET /api/call/:id/code.
    const control = createControl({ store, emit, broadcastCodes: false });
    holder.__refillGuardParts = { control, driver: makeDriver(store, control) };
  }
  return holder.__refillGuardParts;
}

export type AgentChoice = { kind: "claude-api"; model: string } | { kind: "agent-sdk"; model: string } | { kind: "fake" };

/**
 * Which agent runs the calls: Role 1's agent on the Messages API when ANTHROPIC_API_KEY is
 * set; otherwise, with LIVE_AGENT=1, Role 1's agent on the Claude Agent SDK (model from
 * AGENT_SDK_MODEL, Haiku by default, Sonnet for rehearsals); otherwise the contract's fake.
 */
export function describeAgent(): AgentChoice {
  if (process.env.ANTHROPIC_API_KEY) return { kind: "claude-api", model: CALL_MODEL };
  if (process.env.LIVE_AGENT === "1") return { kind: "agent-sdk", model: process.env.AGENT_SDK_MODEL || SDK_DEV_MODEL };
  return { kind: "fake" };
}

function makeDriver(store: Store, control: Control): AgentDriver {
  const choice = describeAgent();
  console.log(`agent: ${choice.kind}${"model" in choice ? ` (${choice.model})` : ""}`);
  if (choice.kind !== "fake") {
    const model: AgentModel = choice.kind === "claude-api" ? createClaudeModel() : createAgentSdkModel({ model: choice.model });
    return createAgentDriver({
      calls: control,
      press: control.press,
      guardSentence: createSpeechGuard({ store, emit }),
      checkCallerLine: createSafetyCheck({ store, emit }),
      model,
      pharmacyName: PHARMACY_NAME,
      emit,
    });
  }
  const fake = createFakeDriver(store, createFakeGuard(store, emit), emit);
  // Calls start through the control layer, never the fake's own startCall.
  return { ...fake, startCall: (opts) => control.startCall(opts) };
}

export const getControl = (): Control => parts().control;
export const getDriver = (): AgentDriver => parts().driver;

/** Test helper: reseed the store and start fresh parts. */
export async function resetRuntimeForTests(): Promise<void> {
  if (pgHolder.__refillGuardPg) {
    void pgHolder.__refillGuardPg.pool.end().catch(() => {});
    pgHolder.__refillGuardPg = undefined;
  }
  await getStore().reset(SEED);
  clearPhoneTokens();
  holder.__refillGuardParts = undefined;
}
