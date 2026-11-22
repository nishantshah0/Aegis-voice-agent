import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audio, start, turn } from "./handlers";

const local = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));
vi.mock("pg", () => ({
  Pool: class {
    db = (local.db ??= new PGlite());
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
const secret = "test".repeat(12);
const root = origin + "/api/presenter/browser";
function post(route: string, body: unknown, cookie = "") {
  return new Request(root + "/" + route, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "x-aegis-presenter": secret,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}
function get(relativeUrl: string, cookie: string) {
  return new Request(new URL(relativeUrl, origin), {
    headers: { "x-aegis-presenter": secret, Cookie: cookie },
  });
}
async function open() {
  const response = await start(post("start", {}));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const body = await response.json();
  const { sessionId, demoCode } = body;
  const say = (text: string, turnId = randomUUID(), step?: number) =>
    turn(post("turn", { sessionId, turnId, text, step }, cookie));
  return { body, sessionId, demoCode, cookie, say };
}

beforeEach(() => {
  vi.stubEnv("AEGIS_DEMO_STORAGE_URL", "postgresql://example@db.invalid/demo");
  vi.stubEnv("AEGIS_PUBLIC_ORIGIN", origin);
  vi.stubEnv("AEGIS_PRESENTER_SECRET", secret);
  vi.stubEnv("ELEVENLABS_API_KEY", "mock");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/"))
        throw new Error("Unexpected provider.");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await local.db?.close();
});

describe("authenticated browser pharmacy demo", () => {
  it("opens a browser-owned session, limits code attempts, and rejects access from other browsers", async () => {
    expect((await start(new Request(root + "/start", { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await start(post("start", { to: "other" }))).status).toBe(400);
    const call = await open();
    const other = await open();
    expect(call.body).toMatchObject({
      finished: false,
      verified: false,
      demoCode: expect.stringMatching(/^\d{6}$/),
    });
    expect(
      (
        await turn(
          post("turn", { sessionId: call.sessionId, turnId: randomUUID(), text: "history" }, other.cookie),
        )
      ).status,
    ).toBe(403);
    expect((await audio(get(call.body.audioUrl, other.cookie))).status).toBe(403);
    const firstAttempt = randomUUID();
    const mismatch = await (await call.say("history", firstAttempt)).json();
    expect(mismatch.reply).toMatch(/didn't match/);
    expect(await (await call.say("history", firstAttempt)).json()).toEqual(mismatch);
    await call.say("wrong");
    expect(await (await call.say("wrong")).json()).toMatchObject({ finished: true, verified: false });
    expect(await (await call.say(call.demoCode)).json()).toMatchObject({ finished: true, verified: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes spoken codes, reads synthetic records, and requires a fresh confirmation per action", async () => {
    const call = await open();
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const code = [...call.demoCode].map((digit) => words[Number(digit)]).join(" ");
    const verified = await (await call.say("My demo code is " + code)).json();
    expect(verified).toMatchObject({ verified: true, step: 1 });
    expect(verified).not.toHaveProperty("demoCode");
    expect((await (await call.say("When was my last fill?")).json()).reply).toMatch(/30 tablets/);
    expect((await (await call.say("What's the seven-day price?")).json()).reply).toMatch(/\$1.25/);
    const pending = await (await call.say("refill")).json();
    expect(pending).toMatchObject({ refillRequested: false, reply: expect.stringMatching(/say yes or no/) });
    expect((await call.say("yes", randomUUID(), pending.step - 1)).status).toBe(409);
    expect((await (await call.say("no")).json()).refillRequested).toBe(false);
    await call.say("refill");
    const key = randomUUID();
    const refill = await (await call.say("yes please", key)).json();
    expect(refill.refillRequested).toBe(true);
    expect((await (await call.say("appointment")).json()).reply).toMatch(
      /Wednesday.*Would you like me to book/,
    );
    const offer = await (await call.say("Thursday instead")).json();
    expect(offer.reply).toMatch(/Thursday.*2 PM Eastern/);
    expect(offer).not.toHaveProperty("appointmentBooked");
    const booked = await (await call.say("Yes please")).json();
    expect(booked.appointmentBooked).toMatch(/Thursday.*2 PM/);
    expect(await (await call.say("yes please", key)).json()).toEqual(refill);
    expect((await (await call.say("End call")).json()).finished).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("commits only one of two conflicting answers to the same refill question", async () => {
    const call = await open();
    await call.say(call.demoCode);
    const offer = await (await call.say("refill")).json();
    const yes = randomUUID(),
      no = randomUUID();
    const responses = await Promise.all([call.say("yes", yes, offer.step), call.say("no", no, offer.step)]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = responses[0].ok ? yes : no;
    const accepted = await responses.find((res) => res.ok)!.json();
    expect(accepted.refillRequested).toBe(winner === yes);
    expect(await (await call.say(winner === yes ? "yes" : "no", winner, offer.step)).json()).toEqual(
      accepted,
    );
  });

  it("voices only persisted replies, reuses generated audio and expires both audio and turns", async () => {
    const call = await open();
    await call.say(call.demoCode);
    const response = await (await call.say("Read back my private invented phrase")).json();
    expect(response.reply).not.toMatch(/private invented/);
    const url = get(response.audioUrl + "&text=never%20say%20this", call.cookie);
    expect((await audio(url)).headers.get("content-type")).toBe("audio/mpeg");
    expect((await audio(url)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body)).text).toBe(response.reply);
    expect(
      (
        await local.db!.query("SELECT * FROM aegis_presenter_browser_turns WHERE session_id=$1", [
          call.sessionId,
        ])
      ).rows.some((row) => JSON.stringify(row).includes("private invented")),
    ).toBe(false);
    await local.db!.query(
      "UPDATE aegis_presenter_browser_turns SET expires_at=now() - interval '1 minute' WHERE session_id=$1",
      [call.sessionId],
    );
    expect((await audio(url)).status).toBe(404);
    expect((await call.say("history")).status).toBe(410);
  });
});
