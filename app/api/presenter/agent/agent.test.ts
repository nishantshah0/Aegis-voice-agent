import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { outboundLookupId } from "@/lib/control";
import { outboundOpener } from "@/lib/agent/lines";
import type { AgentModel } from "@/lib/agent";
import { scriptedModel, type ScriptStep } from "@/lib/agent/testing/scripted-model";
import { demoCode } from "../phone/config";

// The hosted presenter calls run the real agent (Trail #70). Vercel functions share no memory,
// so every turn rebuilds the call from Postgres: the record (control layer) and the driver's
// exported call state. Two module loads (vi.resetModules) stand in for two serverless instances;
// they share only the database, as Vercel functions do.

const { local } = vi.hoisted(() => ({ local: { database: undefined as PGlite | undefined } }));
vi.mock("pg", () => ({
  Pool: class {
    db = (local.database ??= new PGlite());
    on() {}
    query(sql: string, args?: unknown[]) {
      return this.db.query(sql, args);
    }
    async connect() {
      return { query: this.query.bind(this), release() {} };
    }
  },
}));

const secret = "x".repeat(48);
const shared = vi.hoisted(() => ({ steps: [] as ScriptStep[], fail: undefined as Error | undefined, slowMs: 0, seen: [] as string[] }));

/** A fresh "instance": new module state, and a model that plays the script set for this turn. */
async function instance() {
  vi.resetModules();
  const agent = await import("./agent");
  agent.setAgentModelForTests((): AgentModel => {
    const model = scriptedModel(shared.steps);
    return {
      async *turn(request) {
        shared.seen.push(JSON.stringify(request.messages));
        if (shared.fail) throw shared.fail;
        if (shared.slowMs) await new Promise((r) => setTimeout(r, shared.slowMs));
        yield* model.turn(request);
      },
    };
  });
  return agent;
}

beforeEach(async () => {
  vi.stubEnv("AEGIS_DEMO_STORAGE_URL", "postgresql://fixture@db.invalid/fixture");
  vi.stubEnv("AEGIS_PRESENTER_SECRET", secret);
  vi.stubEnv("AEGIS_AGENT_TURNS_PER_HOUR", "");
  vi.stubEnv("AEGIS_AGENT_TURNS_PER_CALL", "");
  shared.steps = [];
  shared.fail = undefined;
  shared.slowMs = 0;
  shared.seen = [];
  local.database ??= new PGlite();
  await local.database.exec("DROP SCHEMA IF EXISTS aegis_presenter_agent CASCADE; CREATE SCHEMA aegis_presenter_agent; SET search_path TO aegis_presenter_agent, public");
});

describe("opening a presenter agent call", () => {
  it("rings Sam through rule 7 on the agent's own store, says the guarded opener, and sends the code", async () => {
    const agent = await instance();
    const id = randomUUID();
    const opened = await agent.openAgent(id);
    expect(opened.reply).toBe(`${outboundOpener("Maple Street Pharmacy", "Sam Rivera")} ${agent.CODE_ON_SCREEN}`);
    expect(opened.verified).toBe(false);
    const record = await (await agent.agentStoreForTests()).listRecord(opened.agent.callId);
    expect(record.some((e) => (e.input as { check?: string })?.check === "call_start")).toBe(true);
    expect(record.some((e) => e.button === "send_code" && e.decision === "allowed")).toBe(true);
    // The code is the presenter screen's demo code, and it's never spoken.
    expect(opened.reply).not.toContain(demoCode(id));
  });
});

describe("a turn served by a fresh instance", () => {
  it("continues the call the previous instance left, through the same buttons and guard", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id);
    const lookup = outboundLookupId(opened.agent.callId);

    // Instance 2: the caller reads the code and date of birth.
    shared.steps = [
      { tools: [{ name: "check_code", input: { lookup_id: lookup, code: demoCode(id), dob: "1990-03-14" } }] },
      { text: ["Thanks, Sam. You're verified."] },
    ];
    const second = await (await instance()).agentTurn(id, opened.agent, `It's ${demoCode(id)}, born March 14 1990.`, { timeoutMs: 5000 });
    expect(second.reply).toBe("Thanks, Sam. You're verified.");
    expect(second.verified).toBe(true);
    expect(second.agent.turns).toBe(1);

    // Instance 3: the model saw the whole call so far, though no instance kept it in memory.
    shared.steps = [{ text: ["What can I help you with today?"] }];
    shared.seen = [];
    const third = await (await instance()).agentTurn(id, second.agent, "What can you do for me?", { timeoutMs: 5000 });
    expect(third.reply).toBe("What can I help you with today?");
    expect(shared.seen[0]).toContain("Thanks, Sam. You're verified.");
    expect(shared.seen[0]).toContain("born March 14 1990");
    expect(third.agent.turns).toBe(2);
  });

  it("never lets an unverified caller hear record details, whichever instance answers", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id);
    shared.steps = [{ text: ["Your Concerta refill is ready."], tools: [{ name: "request_refill", input: { rx_id: "rx_sam_concerta" } }] }, { text: ["First, the code please."] }];
    const turn = await (await instance()).agentTurn(id, opened.agent, "Just refill it.", { timeoutMs: 5000 });
    expect(turn.reply).not.toMatch(/concerta/i);
    expect(turn.verified).toBe(false);
    const record = await (await (await instance()).agentStoreForTests()).listRecord(opened.agent.callId);
    expect(record.find((e) => e.button === "request_refill")?.decision).not.toBe("allowed");
    expect(record.some((e) => e.kind === "line_blocked")).toBe(true);
  });
});

describe("limits and the fallback", () => {
  it("throws AgentUnavailable when the model errors or is too slow, so the caller can fall back", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id);
    shared.fail = new Error("overloaded");
    await expect((await instance()).agentTurn(id, opened.agent, "Hello?", { timeoutMs: 5000 })).rejects.toBeInstanceOf((await import("./agent")).AgentUnavailable);
    shared.fail = undefined;
    shared.slowMs = 300;
    shared.steps = [{ text: ["Late."] }];
    const agent = await instance();
    await expect(agent.agentTurn(id, opened.agent, "Hello?", { timeoutMs: 50 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });

  it("ends a call that reaches its model-turn cap", async () => {
    vi.stubEnv("AEGIS_AGENT_TURNS_PER_CALL", "1");
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id);
    shared.steps = [{ text: ["Okay."] }];
    const one = await (await instance()).agentTurn(id, opened.agent, "Hi", { timeoutMs: 5000 });
    expect(one.ended).toBe(false);
    const two = await (await instance()).agentTurn(id, one.agent, "Hi again", { timeoutMs: 5000 });
    expect(two.ended).toBe(true);
    expect(two.reply).toBe((await import("./agent")).TURN_CAP_LINE);
  });

  it("stops using the model for everyone once the hour's turns are spent", async () => {
    vi.stubEnv("AEGIS_AGENT_TURNS_PER_HOUR", "1");
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id);
    shared.steps = [{ text: ["Okay."] }];
    await (await instance()).agentTurn(id, opened.agent, "Hi", { timeoutMs: 5000 });
    const agent = await instance();
    await expect(agent.agentTurn(id, opened.agent, "Hi again", { timeoutMs: 5000 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
    await expect(agent.openAgent(randomUUID())).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });
});

describe("the agent's database", () => {
  it("refuses to run anywhere but its own schema, so it can never touch the shared demo tables", async () => {
    await local.database!.exec("SET search_path TO public");
    const agent = await instance();
    await expect(agent.openAgent(randomUUID())).rejects.toThrow(/aegis_presenter_agent/);
  });
});
