// A text message to the test patient's real phone, through Twilio (Trail #70). Used for one thing:
// the verification code the control layer sends "to the phone on file" during a real phone call.
// The numbers and the account come only from .env and are never logged or returned.

export function smsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER && env.TEST_PATIENT_PHONE);
}

/** Text TEST_PATIENT_PHONE. False if Twilio isn't set up or refused. */
export async function sendSms(body: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!smsConfigured(env)) return false;
  const sid = env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: env.TEST_PATIENT_PHONE!, From: env.TWILIO_PHONE_NUMBER!, Body: body }),
    });
    if (!res.ok) console.warn(`sms: Twilio answered ${res.status}`);
    return res.ok;
  } catch {
    console.warn("sms: Twilio couldn't be reached");
    return false;
  }
}
