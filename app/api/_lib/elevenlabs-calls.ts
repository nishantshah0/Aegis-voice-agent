// ElevenLabs Agents' telephony API, for the real phone line (Trail #70). Keys, ids and phone
// numbers come only from .env; nothing here logs or returns them.

const API = "https://api.elevenlabs.io";

export const OUTBOUND_ENV = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID", "TEST_PATIENT_PHONE"] as const;

/** The .env names the outbound call still needs (names only, never values). */
export function missingOutboundEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return OUTBOUND_ENV.filter((name) => !env[name]);
}

export type PlacedCall = { ok: true; conversationId?: string } | { ok: false; status: number; message: string };

/**
 * Ring TEST_PATIENT_PHONE from our Twilio number through ElevenLabs. `firstMessage` is what the
 * agent says when they pick up: our opening, already through guardSentence. `callId` reaches our
 * custom LLM endpoint as elevenlabs_extra_body.aegis_call_id on every turn.
 */
export async function placeOutboundCall(callId: string, firstMessage: string, env: NodeJS.ProcessEnv = process.env): Promise<PlacedCall> {
  try {
    const res = await fetch(`${API}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: env.ELEVENLABS_AGENT_ID,
        agent_phone_number_id: env.ELEVENLABS_PHONE_NUMBER_ID,
        to_number: env.TEST_PATIENT_PHONE,
        conversation_initiation_client_data: {
          custom_llm_extra_body: { aegis_call_id: callId },
          conversation_config_override: { agent: { first_message: firstMessage } },
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string; detail?: unknown };
    if (!res.ok || body.success === false) {
      // Their message can quote the number; keep only the status and a generic reason.
      return { ok: false, status: res.status, message: res.status === 401 ? "ElevenLabs refused the API key" : "ElevenLabs couldn't place the call" };
    }
    return { ok: true, conversationId: typeof body.conversation_id === "string" ? body.conversation_id : undefined };
  } catch {
    return { ok: false, status: 502, message: "ElevenLabs couldn't be reached" };
  }
}

/** "done" or "failed" once the phone call is over; undefined if unknown. */
export async function conversationStatus(conversationId: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (!env.ELEVENLABS_API_KEY) return undefined;
  try {
    const res = await fetch(`${API}/v1/convai/conversations/${encodeURIComponent(conversationId)}`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { status?: unknown };
    return typeof body.status === "string" ? body.status : undefined;
  } catch {
    return undefined;
  }
}

export type RegisteredCall = { ok: true; twiml: string } | { ok: false; status: number };

/**
 * Register a call Twilio placed for us (a trial's shared number can't be imported into
 * ElevenLabs). ElevenLabs answers with the TwiML that streams the call to the agent. Same init
 * data as the imported-number route: our call id for the custom LLM, and the guarded opener.
 */
export async function registerTwilioCall(callId: string, firstMessage: string, from: string, to: string, env: NodeJS.ProcessEnv = process.env): Promise<RegisteredCall> {
  try {
    const res = await fetch(`${API}/v1/convai/twilio/register-call`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: env.ELEVENLABS_AGENT_ID,
        from_number: from,
        to_number: to,
        direction: "outbound",
        conversation_initiation_client_data: {
          custom_llm_extra_body: { aegis_call_id: callId },
          conversation_config_override: { agent: { first_message: firstMessage } },
        },
      }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = (await res.text()).trim();
    // Their reference shows the TwiML as a JSON string; the guide shows raw XML. Take either.
    const twiml = text.startsWith('"') ? (JSON.parse(text) as string) : text;
    return twiml.includes("<Response") ? { ok: true, twiml } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: 502 };
  }
}
