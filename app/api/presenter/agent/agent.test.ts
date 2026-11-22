import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { outboundLookupId } from "@/lib/control";
import { outboundOpener } from "@/lib/agent/lines";
import type { AgentModel } from "@/lib/agent";
import { scriptedModel, type ScriptStep } from "@/lib/agent/testing/scripted-model";
import { IDS, SEED } from "@/lib/seed";
import { getStore } from "@/lib/store/memory";
import { demoCode } from "../phone/config";

// The hosted presenter calls run the real agent (Trail #70). Vercel functions share no memory,
// so every turn rebuilds the call from the database: the record and call state (the same store
// the /app dashboard reads, so the call shows there) and the driver's sealed conversation state.
// Two module loads (vi.resetModules) stand in for two serverless instances; they share only
// the stores (here the memory store on globalThis, and PGlite for the presenter's own tables).

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
type Made = { channel: string; model: string; effort: string };
const shared = vi.hoisted(() => ({ steps: [] as unknown[], fail: undefined as Error | undefined, slowMs: 0, seen: [] as string[], made: [] as Made[] }));

/** A fresh "instance": new module state, and a model that plays the script set for this turn. */
async function instance() {
  vi.resetModules();
  const agent = await import("./agent");
  agent.setAgentModelForTests((options): AgentModel => {
    shared.made.push(options);
    const model = scriptedModel(shared.steps as ScriptStep[]);
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
  Object.assign(shared, { steps: [], fail: undefined, slowMs: 0, seen: [], made: [] });
  await getStore().reset(SEED);
  local.database ??= new PGlite();
  await local.database.exec("DROP TABLE IF EXISTS aegis_presenter_agent_turns");
});

describe("opening a presenter agent call", () => {
  it("rings Sam through rule 7 on the dashboard's store, says the guarded opener, and sends the code", async () => {
    const agent = await instance();
    const id = randomUUID();
    const opened = await agent.openAgent(id, "phone");
    expect(opened.reply).toBe(`${outboundOpener("Maple Street Pharmacy", "Sam Rivera")} ${agent.CODE_ON_SCREEN}`);
    expect(opened.verified).toBe(false);
    // The /app dashboard reads this store: the call, its record and its send_code are there.
    const record = await getStore().listRecord(opened.agent.callId);
    expect(record.some((e) => (e.input as { check?: string })?.check === "call_start")).toBe(true);
    expect(record.some((e) => e.button === "send_code" && e.decision === "allowed")).toBe(true);
    expect((await getStore().getCall(opened.agent.callId))?.targetPatientId).toBe(IDS.sam);
    expect(opened.reply).not.toContain(demoCode(id));
  });

  it("uses the call model (Sonnet 5.5): low effort on the phone, medium in the browser", async () => {
    const agent = await instance();
    await agent.openAgent(randomUUID(), "phone");
    await getStore().reset(SEED);
    await agent.openAgent(randomUUID(), "browser");
    expect(shared.made).toEqual([
      { channel: "phone", model: "claude-sonnet-5-5", effort: "low" },
      { channel: "browser", model: "claude-sonnet-5-5", effort: "medium" },
    ]);
  });
});

describe("a turn served by a fresh instance", () => {
  it("continues the call the previous instance left, through the same buttons and guard", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    const lookup = outboundLookupId(opened.agent.callId);
    shared.steps = [
      { tools: [{ name: "check_code", input: { lookup_id: lookup, code: demoCode(id), dob: "1990-03-14" } }] },
      { text: ["Thanks, Sam. You're verified."] },
    ];
    const second = await (await instance()).agentTurn(id, opened.agent, `It's ${demoCode(id)}, born March 14 1990.`, { channel: "phone", timeoutMs: 5000 });
    expect(second.reply).toBe("Thanks, Sam. You're verified.");
    expect(second.verified).toBe(true);
    expect((await getStore().getCall(opened.agent.callId))?.state).toBe("verified");

    shared.steps = [{ text: ["What can I help you with today?"] }];
    shared.seen = [];
    const third = await (await instance()).agentTurn(id, second.agent, "What can you do for me?", { channel: "phone", timeoutMs: 5000 });
    expect(third.reply).toBe("What can I help you with today?");
    expect(shared.seen[0]).toContain("Thanks, Sam. You're verified.");
    expect(shared.seen[0]).toContain("born March 14 1990");
    expect(third.agent.turns).toBe(2);
  });

  it("never lets an unverified caller hear record details, whichever instance answers", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    shared.steps = [{ text: ["Your Concerta refill is ready."], tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] }, { text: ["First, the code please."] }];
    const turn = await (await instance()).agentTurn(id, opened.agent, "Just refill it.", { channel: "phone", timeoutMs: 5000 });
    expect(turn.reply).not.toMatch(/concerta/i);
    expect(turn.verified).toBe(false);
    const record = await getStore().listRecord(opened.agent.callId);
    expect(record.find((e) => e.button === "request_refill")?.decision).not.toBe("allowed");
    expect(record.some((e) => e.kind === "line_blocked")).toBe(true);
  });
});

describe("the sealed snapshot grants nothing", () => {
  it("a snapshot edited to look verified still can't refill, and the presenter still sees unverified", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    const forged = JSON.parse(JSON.stringify(opened.agent));
    forged.snapshot.state.verified = true;
    forged.snapshot.state.refillable = { $map: [[IDS.samConcerta, true]] };
    shared.steps = [{ tools: [{ name: "request_refill", input: { rx_id: IDS.samConcerta } }] }, { text: ["Done."] }];
    const turn = await (await instance()).agentTurn(id, forged, "Refill it now.", { channel: "phone", timeoutMs: 5000 });
    const refill = (await getStore().listRecord(opened.agent.callId)).find((e) => e.button === "request_refill");
    expect(refill?.decision).not.toBe("allowed");
    expect(turn.verified).toBe(false);
    expect(turn.refillRequested).toBe(false);
  });

  it("refuses a snapshot for another call, of another version, or of the wrong shape", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    const agent = await instance();
    const bad = [
      { ...opened.agent, snapshot: { ...(opened.agent.snapshot as object), callId: "c_9999" } },
      { ...opened.agent, snapshot: { ...(opened.agent.snapshot as object), v: 2 } },
      { ...opened.agent, snapshot: { v: 1, callId: opened.agent.callId, state: { messages: "nope" } } },
      { ...opened.agent, snapshot: null },
    ];
    for (const state of bad) await expect(agent.agentTurn(id, state, "Hi", { channel: "phone", timeoutMs: 5000 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });
});

describe("limits and the fallback", () => {
  it("throws AgentUnavailable when the model errors or is too slow, so the caller can fall back", async () => {
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    shared.fail = new Error("overloaded");
    let agent = await instance();
    await expect(agent.agentTurn(id, opened.agent, "Hello?", { channel: "phone", timeoutMs: 5000 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
    shared.fail = undefined;
    shared.slowMs = 300;
    shared.steps = [{ text: ["Late."] }];
    agent = await instance();
    await expect(agent.agentTurn(id, opened.agent, "Hello?", { channel: "phone", timeoutMs: 50 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });

  it("ends a call that reaches its model-turn cap", async () => {
    vi.stubEnv("AEGIS_AGENT_TURNS_PER_CALL", "1");
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    shared.steps = [{ text: ["Okay."] }];
    const one = await (await instance()).agentTurn(id, opened.agent, "Hi", { channel: "phone", timeoutMs: 5000 });
    expect(one.ended).toBe(false);
    const agent = await instance();
    const two = await agent.agentTurn(id, one.agent, "Hi again", { channel: "phone", timeoutMs: 5000 });
    expect(two.ended).toBe(true);
    expect(two.reply).toBe(agent.TURN_CAP_LINE);
  });

  it("stops using the model for everyone once the hour's turns are spent", async () => {
    vi.stubEnv("AEGIS_AGENT_TURNS_PER_HOUR", "1");
    const id = randomUUID();
    const opened = await (await instance()).openAgent(id, "phone");
    shared.steps = [{ text: ["Okay."] }];
    await (await instance()).agentTurn(id, opened.agent, "Hi", { channel: "phone", timeoutMs: 5000 });
    const agent = await instance();
    await expect(agent.agentTurn(id, opened.agent, "Hi again", { channel: "phone", timeoutMs: 5000 })).rejects.toBeInstanceOf(agent.AgentUnavailable);
    await getStore().reset(SEED);
    await expect(agent.openAgent(randomUUID(), "phone")).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });

  it("won't run on Vercel without the dashboard's database, where memory isn't shared", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", "");
    const agent = await instance();
    await expect(agent.openAgent(randomUUID(), "phone")).rejects.toBeInstanceOf(agent.AgentUnavailable);
  });
});
