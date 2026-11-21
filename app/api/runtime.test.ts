import { afterEach, describe, expect, it, vi } from "vitest";
import { describeAgent, getDriver, getStore, resetRuntimeForTests } from "./_lib/runtime";

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetRuntimeForTests();
});

describe("the server's call driver (1.2 support)", () => {
  it("keeps the contract's fake when there's no ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await resetRuntimeForTests();
    expect("speakLine" in getDriver()).toBe(false);
  });

  it("uses Role 1's real agent when a key is set, starting calls through the control layer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    await resetRuntimeForTests();
    const driver = getDriver();
    expect(typeof (driver as { speakLine?: unknown }).speakLine).toBe("function");
    const callId = await driver.startCall({ direction: "inbound" });
    expect(await getStore().getCall(callId)).toMatchObject({ direction: "inbound", state: "greeting" });
  });
});

describe("LIVE_AGENT=1: Role 1's Agent SDK model when there's no API key (demo step 2)", () => {
  it("picks the Agent SDK model, Haiku unless AGENT_SDK_MODEL says otherwise", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("LIVE_AGENT", "1");
    vi.stubEnv("AGENT_SDK_MODEL", "");
    await resetRuntimeForTests();
    expect(describeAgent()).toEqual({ kind: "agent-sdk", model: "claude-haiku-5-5" });
    expect(typeof (getDriver() as { speakLine?: unknown }).speakLine).toBe("function");

    vi.stubEnv("AGENT_SDK_MODEL", "claude-sonnet-5-5");
    await resetRuntimeForTests();
    expect(describeAgent()).toEqual({ kind: "agent-sdk", model: "claude-sonnet-5-5" });
  });

  it("prefers the API key when there is one, and stays fake with neither", async () => {
    vi.stubEnv("LIVE_AGENT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    await resetRuntimeForTests();
    expect(describeAgent()).toEqual({ kind: "claude-api", model: "claude-sonnet-5-5" });

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("LIVE_AGENT", "");
    await resetRuntimeForTests();
    expect(describeAgent()).toEqual({ kind: "fake" });
  });
});
