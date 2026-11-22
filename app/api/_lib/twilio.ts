import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Twilio's REST API and webhooks, for the real phone line on a trial account's shared number
// (Trail #70). The account, the numbers and the token come only from .env and are never logged
// or returned; a refusal comes back as Twilio's error code only, because its message quotes numbers.

export const TWILIO_CALL_ENV = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TEST_PATIENT_PHONE", "VOICE_LLM_URL"] as const;

/** The .env names the Twilio route still needs (names only). */
export function missingTwilioCallEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return TWILIO_CALL_ENV.filter((name) => !env[name]);
}

/** Our public https origin, the one Twilio calls back on: VOICE_PUBLIC_URL, else VOICE_LLM_URL's. */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.VOICE_PUBLIC_URL || env.VOICE_LLM_URL;
  try {
    return raw ? new URL(raw).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Twilio's request signature: HMAC-SHA1 of the URL followed by each field name and value, sorted by name. */
export function twilioSignature(authToken: string, url: string, fields: Record<string, string>): string {
  const data = url + Object.keys(fields).sort().map((name) => name + fields[name]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * The form fields of a request Twilio signed for this exact public URL (path and query
 * included), or null. Behind the tunnel our own request.url is localhost, so the URL is rebuilt
 * from the public origin.
 */
export async function signedTwilioFields(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string> | null> {
  const token = env.TWILIO_AUTH_TOKEN;
  const origin = publicOrigin(env);
  const given = request.headers.get("x-twilio-signature");
  if (!token || !origin || !given) return null;
  let fields: Record<string, string>;
  try {
    fields = Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return null;
  }
  const local = new URL(request.url);
  const expected = Buffer.from(twilioSignature(token, `${origin}${local.pathname}${local.search}`, fields));
  const actual = Buffer.from(given);
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!valid && env.VOICE_LLM_DEBUG === "1") {
    // Names only, never values: enough to see why Twilio's signature didn't match.
    console.log(`twilio: bad signature on ${local.pathname} type=${request.headers.get("content-type")} query=${[...local.searchParams.keys()].join(",")} fields=${Object.keys(fields).sort().join(",")}`);
  }
  return valid ? fields : null;
}

/** A fresh token for one call's TwiML URL. */
export function newUrlToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time check of a URL token. */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given === expected;
}

/**
 * The form fields of a request that carries this URL's token (when `token` is given) or Twilio's
 * signature, or null. A One Console trial fetches the call's Url through its trial flow, whose
 * signature doesn't match our auth token, so that URL also holds a per-call token.
 */
export async function twilioFields(request: Request, token: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string> | null> {
  if (token && tokenMatches(new URL(request.url).searchParams.get("t"), token)) {
    try {
      return Object.fromEntries(new URLSearchParams(await request.text()));
    } catch {
      return null;
    }
  }
  return signedTwilioFields(request, env);
}

export type TwilioCall = { ok: true; sid?: string } | { ok: false; status: number; code?: number; message?: string };

/** Twilio's messages quote phone numbers; hide anything number-like before it leaves the server. */
export function withoutNumbers(text: string): string {
  return text.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, "<number>");
}

/** Ring TEST_PATIENT_PHONE from TWILIO_PHONE_NUMBER; Twilio then fetches `url` for what to do. */
export async function placeTwilioCall(url: string, statusCallback: string, env: NodeJS.ProcessEnv = process.env): Promise<TwilioCall> {
  const sid = env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      // Only these four: a One Console trial refuses Method, StatusCallbackMethod,
      // StatusCallbackEvent and Twiml ("limited parameter access", code 0). Twilio's defaults are
      // what we want anyway: it POSTs to both URLs, and calls back once the call has completed.
      body: new URLSearchParams({ To: env.TEST_PATIENT_PHONE!, From: env.TWILIO_PHONE_NUMBER!, Url: url, StatusCallback: statusCallback }),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: unknown; code?: unknown; message?: unknown };
    if (!res.ok) {
      const message = typeof body.message === "string" ? withoutNumbers(body.message).slice(0, 300) : undefined;
      return { ok: false, status: res.status, code: typeof body.code === "number" ? body.code : undefined, message };
    }
    return { ok: true, sid: typeof body.sid === "string" ? body.sid : undefined };
  } catch {
    return { ok: false, status: 502 };
  }
}

/** TwiML that hangs up. The phone line never uses <Say>: every word it speaks comes from guardSentence. */
export const HANG_UP_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

export function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
