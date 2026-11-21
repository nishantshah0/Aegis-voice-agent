import { afterEach, describe, expect, it, vi } from "vitest";
import { getDriver, getStore, resetRuntimeForTests } from "./_lib/runtime";

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
