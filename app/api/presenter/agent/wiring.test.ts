import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { outboundLookupId } from "@/lib/control";
import { outboundOpener } from "@/lib/agent/lines";
import type { AgentModel } from "@/lib/agent";
import { scriptedModel, type ScriptStep } from "@/lib/agent/testing/scripted-model";
import { twilioSignature } from "../../_lib/twilio";
import { demoCode } from "../phone/config";
import { start as phoneStart, status, twiml } from "../phone/handlers";
import { start as browserStart, turn as browserTurn } from "../browser/handlers";
import { SEED } from "@/lib/seed";
import { CODE_ON_SCREEN, agentStoreForTests, setAgentModelForTests } from "./agent";
import { FALLBACK_LINE } from "./turn";

// Trail #70: the presenter's real phone call (Twilio Gather/Play) and the browser call send the
// caller's words into the real agent, not the scripted menu. The menu is only the fallback when
// the model errors or is too slow, and the presenter screen says so.

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

const origin = "https://presenter.example";
const sid = "CA" + "1".repeat(32),
  account = "AC" + "2".repeat(32),
  secret = "x".repeat(48),
  token = "test-auth";
const OPENER = `${outboundOpener("Maple Street Pharmacy", "Sam Rivera")} ${CODE_ON_SCREEN}`;
const script = vi.hoisted(() => ({ steps: [] as ScriptStep[], fail: false }));

const presenter = (url: string, options: RequestInit = {}) => new Request(url, { ...options, headers: { "x-aegis-presenter": secret, Origin: origin, ...options.headers } });
const signedPost = (url: string, fields: Record<string, string>) =>
  new Request(url, { method: "POST", body: new URLSearchParams(fields), headers: { "X-Twilio-Signature": twilioSignature(token, url, fields) } });
const attr = (xml: string, key: string) => xml.match(new RegExp(key + '="([^"]+)"'))?.[1].replaceAll("&amp;", "&") ?? "";
let voiced: string[] = [];

beforeEach(async () => {
  for (const [key, val] of Object.entries({
    AEGIS_PUBLIC_ORIGIN: origin,
    AEGIS_DEMO_STORAGE_URL: "postgresql://fixture@db.invalid/fixture",
    AEGIS_PRESENTER_SECRET: secret,
    TWILIO_AUTH_TOKEN: token,
    TWILIO_ACCOUNT_SID: account,
    TWILIO_PHONE_NUMBER: "+12025550131",
    TEST_PATIENT_PHONE: "+12025550132",
    ELEVENLABS_API_KEY: "mock",
    ELEVENLABS_VOICE_ID: "mock",
  }))
    vi.stubEnv(key, val);
  // Empty every table between tests. Never drop them: the storage modules create them once per process.
  local.database ??= new PGlite();
  const db = local.database;
  await db.exec("CREATE SCHEMA IF NOT EXISTS aegis_presenter_agent; SET search_path TO aegis_presenter_agent, public");
  const { rows } = await db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'aegis_presenter_agent' AND table_name LIKE 'aegis_%'");
  for (const { t } of rows) await db.exec(`TRUNCATE aegis_presenter_agent.${t} CASCADE`);
  await (await agentStoreForTests()).reset(SEED);
  script.steps = [];
  script.fail = false;
  voiced = [];
  setAgentModelForTests((): AgentModel => {
    const model = scriptedModel(script.steps);
    return {
      async *turn(request) {
        if (script.fail) throw new Error("overloaded");
        yield* model.turn(request);
      },
    };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://api.twilio.com/2010-04-01/Accounts/" + account + "/Calls.json") return Response.json({ sid, status: "queued" });
      if (url.startsWith("https://api.elevenlabs.io/")) {
        voiced.push(JSON.parse(String(init.body)).text);
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error("Unexpected fetch: " + url);
    }),
  );
});
afterEach(() => {
  setAgentModelForTests(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await local.database?.close();
});

async function placePhoneCall() {
  const started = await (await phoneStart(presenter(origin + "/api/presenter/phone/start", { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: "{}" }))).json();
  const first = await twiml(signedPost(`${origin}/api/presenter/phone/twiml?callId=${started.callId}&step=0`, { CallSid: sid, AccountSid: account }));
  return { started, xml: await first.text() };
}

describe("the presenter's real phone call", () => {
  it("answers with the agent's guarded opener and sends each thing the caller says to the agent", async () => {
    const { started, xml } = await placePhoneCall();
    expect(started.assistant).toBe("agent");
    expect(started.demoPatient).toEqual({ name: "Sam Rivera", dob: "1990-03-14" });
    expect(started.demoCode).toBe(demoCode(started.callId));
    expect(voiced).toContain(OPENER);
    expect(xml).toMatch(/<Gather[^>]*input="speech dtmf"/);

    const agentCallId = `p${started.callId.slice(0, 8)}_0001`;
    script.steps = [
      { tools: [{ name: "check_code", input: { lookup_id: outboundLookupId(agentCallId), code: demoCode(started.callId), dob: "1990-03-14" } }] },
      { text: ["Thanks, Sam. You're verified."] },
    ];
    const next = attr(xml, "action");
    const reply = await (await twiml(signedPost(next, { CallSid: sid, AccountSid: account, SpeechResult: `My code is ${demoCode(started.callId)} and I was born March 14 1990` }))).text();
    expect(voiced.at(-1)).toBe("Thanks, Sam. You're verified.");
    expect(reply).toContain("<Gather");
    const view = await (await status(presenter(`${origin}/api/presenter/phone/status?callId=${started.callId}`))).json();
    expect(view.assistant).toBe("agent");
    expect(view).not.toHaveProperty("demoCode");
    expect(view).not.toHaveProperty("demoPatient");
  });

  it("falls back to the scripted menu, and says so, when the model fails", async () => {
    const { started, xml } = await placePhoneCall();
    script.fail = true;
    await twiml(signedPost(attr(xml, "action"), { CallSid: sid, AccountSid: account, SpeechResult: "Hello?" }));
    expect(voiced.at(-1)?.startsWith(FALLBACK_LINE)).toBe(true);
    const view = await (await status(presenter(`${origin}/api/presenter/phone/status?callId=${started.callId}`))).json();
    expect(view.assistant).toBe("fallback");
    expect(view.demoCode).toBe(demoCode(started.callId));
  });

  it("keeps the scripted menu when no model is configured", async () => {
    setAgentModelForTests(undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { started } = await placePhoneCall();
    expect(started.assistant).toBe("menu");
    expect(voiced.at(-1)).toMatch(/six digits/);
  });
});

describe("the presenter's browser call", () => {
  async function open() {
    const response = await browserStart(presenter(origin + "/api/presenter/browser/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const body = await response.json();
    const say = async (text: string) =>
      (await browserTurn(presenter(origin + "/api/presenter/browser/turn", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ sessionId: body.sessionId, turnId: randomUUID(), text }) }))).json();
    return { body, say };
  }

  it("opens with the agent and answers each line through it", async () => {
    const { body, say } = await open();
    expect(body.assistant).toBe("agent");
    expect(body.reply).toBe(OPENER);
    expect(body.demoPatient).toEqual({ name: "Sam Rivera", dob: "1990-03-14" });
    script.steps = [{ text: ["What's the code on your screen, and your date of birth?"] }];
    const next = await say("Yes, this is Sam.");
    expect(next.reply).toBe("What's the code on your screen, and your date of birth?");
    expect(next.assistant).toBe("agent");
  });

  it("falls back to the menu when the model fails", async () => {
    const { say } = await open();
    script.fail = true;
    const next = await say("Hello?");
    expect(next.assistant).toBe("fallback");
    expect(next.reply.startsWith(FALLBACK_LINE)).toBe(true);
  });
});
