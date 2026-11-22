// Trail #70: the ElevenLabs agent for the real phone line, as code. Creates it (or updates it,
// when ELEVENLABS_AGENT_ID is set) with OUR server as its custom LLM, so ElevenLabs only does
// the phone, speech to text and text to speech. Its own model never writes a word, and it has
// no tools of its own except end_call, which our endpoint sends only after our driver ended the call.
//
//   node scripts/elevenlabs-agent.ts --dry-run       print the agent config (no secrets), change nothing
//   node scripts/elevenlabs-agent.ts                 create or update the agent (and the Twilio number)
//   node scripts/elevenlabs-agent.ts --write-env     ...and save the new ids (not secrets) to .env
//
// Reads .env: ELEVENLABS_API_KEY, VOICE_LLM_URL (public https URL of /api/voice/llm), VOICE_LLM_SECRET,
// and optionally ELEVENLABS_VOICE_ID, ELEVENLABS_AGENT_ID, ELEVENLABS_LLM_SECRET_ID,
// ELEVENLABS_PHONE_NUMBER_ID, and TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER
// (to import the Twilio number). It prints ids only: never a key, a secret or a phone number.
// Plain node (type stripping), so no @/ imports; scripts/elevenlabs-agent.test.ts checks that the
// greeting below is word for word the driver's inboundGreeting.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.elevenlabs.io";
export const PHARMACY = "Maple Street Pharmacy";
/** lib/agent/lines.ts inboundGreeting(PHARMACY_NAME). The driver puts the same line through guardSentence on the record. */
export const GREETING = `Hi, this is the automated assistant for ${PHARMACY}. What can I help with?`;

/**
 * ElevenLabs sends this as the system message. Our endpoint ignores it except for the tag, which
 * names the conversation so each phone call maps to one of our calls.
 */
export const PROMPT = [
  "[aegis-conversation:{{system__conversation_id}}]",
  `You are the phone line of ${PHARMACY}. Every reply comes from the pharmacy's own server, which decides what is said and done.`,
].join("\n");

export type AgentConfigInput = { llmUrl: string; secretId: string; voiceId?: string };

export function agentConfig({ llmUrl, secretId, voiceId }: AgentConfigInput) {
  return {
    name: `Aegis phone line (${PHARMACY})`,
    conversation_config: {
      agent: {
        first_message: GREETING,
        language: "en",
        prompt: {
          prompt: PROMPT,
          llm: "custom-llm",
          custom_llm: { url: llmUrl, model_id: "aegis", api_key: { secret_id: secretId } },
          temperature: 0,
          // Only end_call: our endpoint sends it once our driver has ended the call.
          built_in_tools: { end_call: { name: "end_call", description: "Hang up. Only the pharmacy's server decides this.", params: { system_tool_type: "end_call" } } },
          tool_ids: [],
        },
      },
      tts: { model_id: "eleven_flash_v2", ...(voiceId ? { voice_id: voiceId } : {}) },
      // Nothing ElevenLabs would say on its own: no filler while we think, no noise warning, no
      // guessing a turn early. Silence and time-limit messages stay empty.
      turn: { soft_timeout_config: { timeout_seconds: -1 }, noisy_environment_detection: false, speculative_turn: false },
      // The whole history every turn: the endpoint counts the caller's messages to find the new ones.
      conversation: { max_duration_seconds: 600, compaction: { enabled: false } },
    },
    platform_settings: {
      // Only phone calls and signed URLs start conversations, not anyone who knows the agent id.
      auth: { enable_auth: true },
      overrides: {
        // The outbound route sets the opener (already guarded) and our call id per call.
        conversation_config_override: { agent: { first_message: true } },
        custom_llm_extra_body: true,
      },
    },
  };
}

type Env = Record<string, string | undefined>;

/** Their error messages can quote a phone number; this session is recorded, so hide anything number-like. */
export function redact(text: string): string {
  return text.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, "<number>");
}

async function api(env: Env, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${redact(text.slice(0, 400))}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function ensureSecret(env: Env): Promise<string> {
  const name = "aegis_voice_llm_secret";
  if (env.ELEVENLABS_LLM_SECRET_ID) {
    await api(env, "PATCH", `/v1/convai/secrets/${env.ELEVENLABS_LLM_SECRET_ID}`, { type: "update", name, value: env.VOICE_LLM_SECRET });
    return env.ELEVENLABS_LLM_SECRET_ID;
  }
  const made = await api(env, "POST", "/v1/convai/secrets", { type: "new", name, value: env.VOICE_LLM_SECRET });
  return String(made.secret_id);
}

async function ensureAgent(env: Env, secretId: string): Promise<string> {
  const config = agentConfig({ llmUrl: env.VOICE_LLM_URL!, secretId, voiceId: env.ELEVENLABS_VOICE_ID });
  if (env.ELEVENLABS_AGENT_ID) {
    await api(env, "PATCH", `/v1/convai/agents/${env.ELEVENLABS_AGENT_ID}`, config);
    return env.ELEVENLABS_AGENT_ID;
  }
  const made = await api(env, "POST", "/v1/convai/agents/create", config);
  return String(made.agent_id);
}

async function ensurePhoneNumber(env: Env, agentId: string): Promise<string | undefined> {
  if (env.ELEVENLABS_PHONE_NUMBER_ID) {
    await api(env, "PATCH", `/v1/convai/phone-numbers/${env.ELEVENLABS_PHONE_NUMBER_ID}`, { agent_id: agentId });
    return env.ELEVENLABS_PHONE_NUMBER_ID;
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return undefined;
  const made = await api(env, "POST", "/v1/convai/phone-numbers", {
    provider: "twilio",
    label: `Aegis ${PHARMACY}`,
    phone_number: env.TWILIO_PHONE_NUMBER,
    sid: env.TWILIO_ACCOUNT_SID,
    token: env.TWILIO_AUTH_TOKEN,
    agent_id: agentId,
  });
  return String(made.phone_number_id);
}

/** Set NAME=value lines in .env, keeping everything else as it is. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    out = pattern.test(out) ? out.replace(pattern, line) : `${out.replace(/\n*$/, "\n")}${line}\n`;
  }
  return out;
}

export function missing(env: Env): string[] {
  const need = ["ELEVENLABS_API_KEY", "VOICE_LLM_URL", "VOICE_LLM_SECRET"].filter((n) => !env[n]);
  if (env.VOICE_LLM_URL && !env.VOICE_LLM_URL.startsWith("https://")) need.push("VOICE_LLM_URL (must be https://)");
  if (env.VOICE_LLM_SECRET && env.VOICE_LLM_SECRET.length < 16) need.push("VOICE_LLM_SECRET (16+ characters)");
  return need;
}

export async function main(argv: string[], env: Env = process.env): Promise<void> {
  if (argv.includes("--dry-run")) {
    console.log(JSON.stringify(agentConfig({ llmUrl: env.VOICE_LLM_URL ?? "https://<tunnel>/api/voice/llm", secretId: "<secret id>", voiceId: env.ELEVENLABS_VOICE_ID }), null, 2));
    return;
  }
  const need = missing(env);
  if (need.length) throw new Error(`Set these in .env first: ${need.join(", ")}`);
  // Each id is saved as soon as it exists, so a failure later (often the Twilio number) never
  // leaves a secret or an agent behind that the next run would create again.
  const save = (ids: Record<string, string>) => {
    for (const [name, value] of Object.entries(ids)) {
      console.log(`${name}=${value}`);
      env[name] = value;
    }
    if (argv.includes("--write-env") && existsSync(".env")) writeFileSync(".env", upsertEnv(readFileSync(".env", "utf8"), ids));
  };
  save({ ELEVENLABS_LLM_SECRET_ID: await ensureSecret(env) });
  save({ ELEVENLABS_AGENT_ID: await ensureAgent(env, env.ELEVENLABS_LLM_SECRET_ID!) });
  const phoneNumberId = await ensurePhoneNumber(env, env.ELEVENLABS_AGENT_ID!).catch((error: unknown) => {
    console.error(`The Twilio number wasn't imported: ${error instanceof Error ? error.message : "unknown error"}`);
    return undefined;
  });
  if (phoneNumberId) save({ ELEVENLABS_PHONE_NUMBER_ID: phoneNumberId });
  else console.log("No phone number yet: put a number your Twilio account owns in TWILIO_PHONE_NUMBER (with TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN) and run this again.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
