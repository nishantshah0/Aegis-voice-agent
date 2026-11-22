import { describe, expect, it } from "vitest";
import { inboundGreeting } from "@/lib/agent/lines";
import { PHARMACY_NAME } from "@/lib/seed";
import { parseChatRequest } from "@/app/api/_lib/voice-line";
import { GREETING, PHARMACY, PROMPT, agentConfig, missing, redact, upsertEnv } from "./elevenlabs-agent";

// Trail #70: the ElevenLabs agent config the phone line runs on.

describe("scripts/elevenlabs-agent.ts", () => {
  it("speaks the driver's own fixed greeting first, word for word", () => {
    expect(PHARMACY).toBe(PHARMACY_NAME);
    expect(GREETING).toBe(inboundGreeting(PHARMACY_NAME));
  });

  it("points the agent at our endpoint as its only LLM, with the secret by reference", () => {
    const config = agentConfig({ llmUrl: "https://example.test/api/voice/llm", secretId: "sec_1" });
    expect(config.conversation_config.agent.prompt.llm).toBe("custom-llm");
    expect(config.conversation_config.agent.prompt.custom_llm).toEqual({ url: "https://example.test/api/voice/llm", model_id: "aegis", api_key: { secret_id: "sec_1" } });
    expect(config.conversation_config.agent.prompt.tool_ids).toEqual([]);
    expect(Object.keys(config.conversation_config.agent.prompt.built_in_tools)).toEqual(["end_call"]);
    expect(JSON.stringify(config)).not.toMatch(/secret_value|VOICE_LLM_SECRET/);
  });

  it("tags the system prompt so the endpoint can tell conversations apart", () => {
    const filled = PROMPT.replace("{{system__conversation_id}}", "conv_abc123");
    const chat = parseChatRequest({ messages: [{ role: "system", content: filled }, { role: "user", content: "Hi" }] });
    expect("error" in chat ? undefined : chat.conversationId).toBe("conv_abc123");
  });

  it("refuses to run without an https URL and a long secret, and saves ids to .env in place", () => {
    expect(missing({ ELEVENLABS_API_KEY: "k", VOICE_LLM_URL: "http://x", VOICE_LLM_SECRET: "short" })).toEqual(["VOICE_LLM_URL (must be https://)", "VOICE_LLM_SECRET (16+ characters)"]);
    expect(upsertEnv("A=1\nELEVENLABS_AGENT_ID=old\n", { ELEVENLABS_AGENT_ID: "agent_new", ELEVENLABS_PHONE_NUMBER_ID: "ph_1" })).toBe("A=1\nELEVENLABS_AGENT_ID=agent_new\nELEVENLABS_PHONE_NUMBER_ID=ph_1\n");
  });

  it("hides phone numbers in ElevenLabs' error messages (this session is recorded)", () => {
    expect(redact('Phone number +15555550123 not found; also (555) 555-0199')).toBe("Phone number <number> not found; also <number>");
  });

  it("leaves ElevenLabs nothing to say on its own, and no way in without a phone call or signed URL", () => {
    const config = agentConfig({ llmUrl: "https://example.test/api/voice/llm", secretId: "sec_1" });
    expect(config.conversation_config.turn).toEqual({ soft_timeout_config: { timeout_seconds: -1 }, noisy_environment_detection: false, speculative_turn: false });
    expect(config.platform_settings.auth.enable_auth).toBe(true);
  });

  it("speaks and listens in Twilio's audio format (u-law 8000), as register-call needs", () => {
    const config = agentConfig({ llmUrl: "https://example.test/api/voice/llm", secretId: "sec_1" });
    expect(config.conversation_config.asr).toEqual({ user_input_audio_format: "ulaw_8000" });
    expect(config.conversation_config.tts.agent_output_audio_format).toBe("ulaw_8000");
  });
});
