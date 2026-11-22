import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { twilioSignature } from "../../_lib/twilio";
import { clip, event, start, status, twiml } from "./handlers";

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
  secret = "x".repeat(48);
const token = "test-auth";
const link = (route: string) => origin + "/api/presenter/phone/" + route;
const presenter = (url: string, options: RequestInit = {}) =>
  new Request(url, { ...options, headers: { "x-aegis-presenter": secret, ...options.headers } });
const startReq = (key = randomUUID(), body = "{}") =>
  presenter(link("start"), { method: "POST", headers: { "Idempotency-Key": key }, body });
function post(url: string, fields: Record<string, string>, signed = false) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: signed ? { "X-Twilio-Signature": twilioSignature(token, url, fields) } : {},
  });
}
let dialBody: URLSearchParams;
let dials = 0;
let voiceTexts: string[] = [];
let failVoice = false;
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
  if (local.database)
    await local.database.exec(
      "TRUNCATE aegis_presenter_requests, aegis_presenter_audio, aegis_presenter_calls",
    );
  dials = 0;
  voiceTexts = [];
  failVoice = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://api.twilio.com/2010-04-01/Accounts/" + account + "/Calls.json") {
        dials++;
        dialBody = new URLSearchParams(init.body as URLSearchParams);
        return Response.json({ sid, status: "queued" });
      }
      if (url.startsWith("https://api.elevenlabs.io/")) {
        voiceTexts.push(JSON.parse(String(init.body)).text);
        return failVoice ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error("Unexpected fetch in offline phone test");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await local.database?.close();
});
const attr = (xml: string, key: string) =>
  xml.match(new RegExp(key + '="([^"]+)"'))?.[1].replaceAll("&amp;", "&") ?? "";
async function gather(url: string, digits = "", speech = "") {
  return (
    await twiml(post(url, { CallSid: sid, AccountSid: account, Digits: digits, SpeechResult: speech }))
  ).text();
}
describe("presenter phone on a synthetic record, with in-memory PostgreSQL and offline providers", () => {
  it("protects kickoff, rejects caller-chosen numbers and never calls a provider on denial", async () => {
    expect((await start(new Request(link("start"), { method: "POST" }))).status).toBe(403);
    expect((await start(startReq(randomUUID(), '{"to":"other"}'))).status).toBe(400);
    expect(
      (
        await start(
          presenter(link("start"), { method: "POST", headers: { origin: "https://other.example" } }),
        )
      ).status,
    ).toBe(403);
    expect((await status(new Request(link("status")))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("persists signed Gather turns, replays retries, and books a fictional seven-day refill only on confirmation", async () => {
    const key = randomUUID(),
      second = randomUUID();
    const reply = await (await start(startReq(key))).json();
    expect(reply).toMatchObject({
      status: "queued",
      refillRequested: false,
      demoCode: expect.stringMatching(/^\d{6}$/),
    });
    expect([...dialBody.keys()].sort()).toEqual(["From", "StatusCallback", "To", "Url"]);
    expect(dialBody.get("To")).toBe(process.env.TEST_PATIENT_PHONE);
    expect((await (await start(startReq(second))).json()).callId).toBe(reply.callId);
    const endpoint = link("status") + "?callId=" + reply.callId;
    const original = dialBody.get("Url")!;
    const wrong = new URL(original);
    wrong.searchParams.set("step", "1");
    expect((await twiml(post(wrong.href, { AccountSid: account, CallSid: sid }))).status).toBe(403);
    let xml = await gather(original);
    expect(xml).toContain('numDigits="6"');
    expect(voiceTexts[0]).toContain("fictional");
    const audio = xml.match(/<Play>([^<]+)<\/Play>/)![1].replaceAll("&amp;", "&");
    expect(await (await clip(new Request(audio))).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    const altered = new URL(audio);
    altered.searchParams.set("token", "wrong");
    expect((await clip(new Request(altered))).status).toBe(403);
    const pin = attr(xml, "action");
    xml = await gather(pin, reply.demoCode);
    expect(await (await status(presenter(endpoint))).json()).not.toHaveProperty("demoCode");
    expect(await gather(pin, "000000")).toBe(xml);
    xml = await gather(attr(xml, "action"), "", "When was my last fill?");
    expect(voiceTexts.at(-1)).toMatch(/30 tablets/i);
    xml = await gather(attr(xml, "action"), "2");
    expect(voiceTexts.at(-1)).toMatch(/one dollar and twenty-five cents/i);
    expect(voiceTexts.at(-1)).toMatch(/three dollars and twenty-five cents/i);
    xml = await gather(attr(xml, "action"), "3");
    expect(voiceTexts.at(-1)).toMatch(/confirm/i);
    xml = await gather(attr(xml, "action"), "", "maybe");
    expect((await (await status(presenter(endpoint))).json()).refillRequested).toBe(false);
    xml = await gather(attr(xml, "action"), "3");
    const consent = attr(xml, "action");
    xml = await gather(consent, "", "yes please");
    expect(voiceTexts.at(-1)).toMatch(/refill request/i);
    expect(voiceTexts.at(-1)).toMatch(/7.day|7 days|seven.day/i);
    expect((await (await status(presenter(endpoint))).json()).refillRequested).toBe(true);
    expect(await gather(consent, "1")).toBe(xml);
    expect(await gather(attr(xml, "action"), "0")).toContain("<Hangup");
    const callback = dialBody.get("StatusCallback")!;
    const final = { AccountSid: account, CallSid: sid, CallStatus: "completed" };
    expect((await event(post(callback, final))).status).toBe(403);
    expect((await event(post(callback, final, true))).status).toBe(204);
    await event(post(callback, { ...final, CallStatus: "ringing" }, true));
    expect((await (await status(presenter(endpoint))).json()).status).toBe("completed");
    expect((await (await start(startReq(second))).json()).callId).toBe(reply.callId);
    expect((await (await start(startReq(key))).json()).callId).toBe(reply.callId);
    expect(dials).toBe(1);
  }, 30_000);
  it("corrects an offered day, asks again for that exact time and books once on the caller's confirmation", async () => {
    const call = await (await start(startReq())).json();
    let xml = await gather(dialBody.get("Url")!);
    xml = await gather(attr(xml, "action"), call.demoCode);
    xml = await gather(attr(xml, "action"), "4");
    expect(voiceTexts.at(-1)).toMatch(/Wednesday.*10 AM Eastern.*Would you like me to book/);
    expect(xml.indexOf("<Play>")).toBeLessThan(xml.indexOf("<Gather "));
    xml = await gather(attr(xml, "action"), "", "Actually Thursday, please");
    expect(voiceTexts.at(-1)).toMatch(/Thursday.*2 PM Eastern.*Would you like me to book/);
    const endpoint = link("status") + "?callId=" + call.callId;
    expect(await (await status(presenter(endpoint))).json()).not.toHaveProperty("appointmentBooked");
    const offer = attr(xml, "action");
    xml = await gather(offer, "", "yes please");
    expect(voiceTexts.at(-1)).toMatch(/booked for Thursday.*2 PM Eastern/);
    expect((await (await status(presenter(endpoint))).json()).appointmentBooked).toMatch(/^Thursday/);
    expect(await gather(offer, "1")).toBe(xml);
  });
  it("accepts a spoken six-digit code and a spoken history request without a keypad", async () => {
    const call = await (await start(startReq())).json();
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const spoken = [...String(call.demoCode)].map(digit => words[Number(digit)]).join(" ");
    let xml = await gather(dialBody.get("Url")!);
    expect(xml).toContain('input="speech dtmf" numDigits="6"');
    xml = await gather(attr(xml, "action"), "", "My code is " + spoken);
    expect(voiceTexts.at(-1)).toContain("in the fictional record");
    await gather(attr(xml, "action"), "", "When was my last refill?");
    expect(voiceTexts.at(-1)).toMatch(/30 tablets|amlodipine/i);
  });
  it("closes after three wrong codes, falls back to spoken TwiML and discloses no fictional history beforehand", async () => {
    const result = await (await start(startReq())).json();
    const wrong = result.demoCode === "000000" ? "000001" : "000000";
    failVoice = true;
    let xml = await gather(dialBody.get("Url")!);
    expect(xml).toContain("<Say>");
    for (let i = 0; i < 3; i++) xml = await gather(attr(xml, "action"), wrong, "last refill");
    expect(xml).toContain("<Hangup");
    expect(voiceTexts.join(" ")).not.toMatch(/30 tablets|one dollar|amlodipine/i);
  });
});
