// The verification code by text on a Twilio TRIAL account (set TWILIO_VERIFY_SERVICE_SID).
// Trials can't send free-form texts (error 572006), but Twilio Verify can text a one-time code.
// Verify makes its own code, so the phone line bridges: when the caller reads a code back, Verify
// checks it, and only an approved code is swapped for the lock's own code before the driver sees
// the line. A wrong code reaches the lock unchanged and fails there, so the lock's expiry,
// attempt limits and lockout still decide everything. Codes are never logged.

const VERIFY = "https://verify.twilio.com/v2/Services";

export function verifyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.TWILIO_VERIFY_SERVICE_SID && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TEST_PATIENT_PHONE);
}

async function post(path: string, fields: Record<string, string>, env: NodeJS.ProcessEnv): Promise<Record<string, unknown> | null> {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  try {
    const res = await fetch(`${VERIFY}/${encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID!)}/${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    if (!res.ok) {
      console.warn(`verify: Twilio answered ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch {
    console.warn("verify: Twilio couldn't be reached");
    return null;
  }
}

/** Text a fresh one-time code to TEST_PATIENT_PHONE. False if Verify isn't set up or refused. */
export async function startVerify(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!verifyConfigured(env)) return false;
  return (await post("Verifications", { To: env.TEST_PATIENT_PHONE!, Channel: "sms" }, env)) !== null;
}

/** True only when Verify approves this code for TEST_PATIENT_PHONE. */
export async function checkVerify(code: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!verifyConfigured(env)) return false;
  const out = await post("VerificationCheck", { To: env.TEST_PATIENT_PHONE!, Code: code }, env);
  return out?.status === "approved";
}

const WORDS: Record<string, string> = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

/** The caller's line with spoken number words as digits ("seven four five" -> "7 4 5"). */
function digitsFromWords(text: string): string {
  return text.replace(/\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/gi, (w) => WORDS[w.toLowerCase()]);
}

/** A 6-digit code said in the line (digits may be spaced or dashed), with where it sits. */
export function spokenCode(text: string): { text: string; code: string; at: number; length: number } | undefined {
  const t = digitsFromWords(text);
  const m = /\d(?:[\s,.-]*\d){5}/.exec(t);
  if (!m) return undefined;
  return { text: t, code: m[0].replace(/\D/g, ""), at: m.index, length: m[0].length };
}
