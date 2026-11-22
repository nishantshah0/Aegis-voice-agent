import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "@/lib/agent/model";
import { scriptedModel } from "@/lib/agent/testing/scripted-model";
import type { RecordEntry } from "@/lib/contract";
import { verifiedReplayTicket } from "../../_lib/replay-tickets";
import { publicDemoLine, type DemoEvent } from "./run";
import { POST } from "./route";

const factory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent", async original => ({
  ...(await original<typeof import("@/lib/agent")>()), createClaudeModel: factory,
}));

const url = "http://localhost:3002/api/simulation/live";
const req = (payload: unknown, target = url) => new Request(target, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
const id = "greeting_slang_recovery";
const speak = (text: string) => ({ text: [text] });
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "live-simulation-"));
  vi.stubGlobal("__simulationLiveRuns", { active: 0, starts: [] });
  vi.stubEnv("PATIENT_SIMULATION", "community-demo");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-voice-key");
  vi.stubEnv("RESULTS_DIR", root);
  factory.mockReset().mockImplementation(() => scriptedModel([speak("Could you say that again?"), speak("What do you need help with?")]));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("the fixed local simulation stream", () => {
  it("streams spoken lines and scored checks, saves redacted evidence without tickets, and never opens a real database", async () => {
    const response = await POST(req({ scenarioId: id }));
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const events: DemoEvent[] = (await response.text()).trim().split("\n").map(s => JSON.parse(s));
    expect(events[0]).toEqual({ type: "start", scenarioId: id });
    expect(events.at(-1)).toMatchObject({ type: "verdict", passed: true, broken: 0 });
    expect(events.some(e => e.type === "check" && e.passed)).toBe(true);
    const caller = events.find(e => e.type === "line" && e.speaker === "caller");
    if (caller?.type !== "line") throw new Error("Missing caller");
    expect(verifiedReplayTicket(caller.ticket, "test-voice-key")).toMatchObject({ speaker: "caller", text: "hey" });
    const [file] = await readdir(join(root, "simulation-live"));
    const saved = await readFile(join(root, "simulation-live", file), "utf8");
    expect(saved).not.toMatch(/"ticket"|"lookup_id"|"codeHash"/);
    expect(JSON.parse(saved).events.at(-1)).toEqual(events.at(-1));
  });

  it("only runs listed scenarios in an isolated local demo", async () => {
    for (const payload of [{ scenarioId: "__proto__" }, { scenarioId: id, text: "freeform" }, {}]) {
      expect((await POST(req(payload))).status).toBe(400);
    }
    expect((await POST(req({ scenarioId: id }, "https://demo.example/api/simulation/live"))).status).toBe(403);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    for (const scenarioId of ["sam_ordinary_refill", "corrected_consultation_time", "greeting_slang_recovery"]) {
      expect((await POST(req({ scenarioId }))).status).toBe(503);
    }
    vi.stubEnv("DATABASE_URL", "postgresql://unused.invalid");
    expect((await POST(req({ scenarioId: id }))).status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });

  it("streams two calls independently and releases only the slot of a completed call", async () => {
    const held = Promise.withResolvers<void>();
    const quick = Promise.withResolvers<void>();
    const replacement = Promise.withResolvers<void>();
    function delayedModel(gate: Promise<void>, reply: string) {
      const model = scriptedModel([speak(reply), speak("How can I help?")]);
      return { async *turn(request: ModelRequest) {
        await gate;
        yield* model.turn(request);
      } };
    }
    factory.mockImplementationOnce(() => delayedModel(held.promise, "Can you repeat that?"));
    factory.mockImplementationOnce(() => delayedModel(quick.promise, "Can you say that again?"));
    factory.mockImplementationOnce(() => delayedModel(replacement.promise, "What can I help with?"));
    const first = await POST(req({ scenarioId: id }));
    const second = await POST(req({ scenarioId: id }));
    try {
      expect([first.status, second.status]).toEqual([200, 200]);
      expect((await POST(req({ scenarioId: id }))).status).toBe(429);
      expect(factory).toHaveBeenCalledTimes(2);

      quick.resolve();
      const secondText = await second.text();
      expect(secondText).toContain("Can you say that again?");
      expect(secondText).not.toContain("Can you repeat that?");
      expect(secondText).toContain('"type":"verdict"');

      const next = await POST(req({ scenarioId: id }));
      expect(next.status).toBe(200);
      expect((await POST(req({ scenarioId: id }))).status).toBe(429);
      replacement.resolve();
      expect(await next.text()).toContain('"type":"verdict"');
    } finally {
      replacement.resolve();
      quick.resolve();
      held.resolve();
      const firstText = await first.text();
      expect(firstText).toContain("Can you repeat that?");
      expect(firstText).not.toContain("Can you say that again?");
    }
  });

  it("retains the six-start rolling budget across concurrent and finished calls", async () => {
    const now = Date.now();
    vi.stubGlobal("__simulationLiveRuns", { active: 0, starts: [now - 3_600_001, ...Array(5).fill(now)] });
    const admitted = await POST(req({ scenarioId: id }));
    expect(admitted.status).toBe(200);
    expect((await POST(req({ scenarioId: id }))).status).toBe(429);
    await admitted.text();
    expect((await POST(req({ scenarioId: id }))).status).toBe(429);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("aborts an active provider request on stream cancellation and releases the run slot", async () => {
    const real = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
    factory.mockImplementation(real.createClaudeModel);
    const started = Promise.withResolvers<AbortSignal>();
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      const signal = init!.signal!;
      started.resolve(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const response = await POST(req({ scenarioId: id }));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"start"');
    const upstream = await started.promise;
    await reader.cancel();
    expect(upstream.aborted).toBe(true);
    await vi.waitFor(() => expect((globalThis as { __simulationLiveRuns?: { active: number } }).__simulationLiveRuns?.active).toBe(0));
    expect(await readdir(root)).toEqual([]);
  });

  it("reports an upstream failure without exposing its details or emitting a verdict", async () => {
    factory.mockImplementationOnce(() => { throw new Error("PRIVATE UPSTREAM LOG"); });
    const response = await POST(req({ scenarioId: id }));
    const text = await response.text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toMatch(/PRIVATE UPSTREAM LOG|"type":"verdict"/);
    expect((globalThis as { __simulationLiveRuns?: { active: number } }).__simulationLiveRuns?.active).toBe(0);
  });

  it("streams only the provider status when a model request is rejected", async () => {
    factory.mockImplementation(() => ({ async *turn() {
      throw Object.assign(new Error("internal prompt and credential"), { status: 429 });
    } }));
    const response = await POST(req({ scenarioId: id }));
    const text = await response.text();
    expect(text).toContain("The model provider returned HTTP 429. No verdict was scored.");
    expect(text).not.toMatch(/internal prompt and credential|"type":"verdict"/);
  });

  it("only publishes safe speech, including the replacement when the guard blocks an original", () => {
    const entry = (kind: string, text: string, replacement?: string) => ({ kind, input: { text }, output: { replacement } }) as RecordEntry;
    for (const text of ["My code is 123456.", "One two three four five six.", "My birthday is September twenty-first.", "March fourteenth, nineteen ninety.", "Sam Rivera.", "RX-100701."]) {
      expect(publicDemoLine(entry("caller_line", text), false, "123456")?.text).toBe("[Verification details omitted]");
    }
    expect(publicDemoLine(entry("caller_line", "I'm Tom."), true, "123456")?.text).toBe("[Verification details omitted]");
    expect(publicDemoLine(entry("line_blocked", "private draft", "Can you repeat that?"), false, "123456")?.text).toBe("Can you repeat that?");
  });
});
