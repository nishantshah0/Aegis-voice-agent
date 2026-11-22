// 1.2b: the Agent SDK model behind the real driver and the real lock, with a fake
// SDK session: the fake "model" calls the button tools it was given, exactly as the
// SDK would. No live calls.
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/contract";
import { BUTTON_NAMES } from "@/lib/contract";
import { createControl, outboundLookupId } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { SDK_DEV_MODEL, SDK_MAX_TURNS, createAgentSdkModel, type ButtonTool, type SdkTurnEvent, type StartSdkSession } from "./agent-sdk";
import { createAgentDriver } from "./driver";
import { collect } from "./testing/scripted-model";
import { UsageCapError, createUsageCap } from "./usage";

const CODE = "112358";

type Step = (tools: ButtonTool[], text: string) => AsyncGenerator<SdkTurnEvent>;

/** A fake SDK session that plays one step per caller line and records what it was sent. */
function fakeSessions(steps: Step[]) {
  const started: { system: string; tools: ButtonTool[]; model: string; maxTurns: number }[] = [];
  const sent: string[] = [];
  let closed = 0;
  const start: StartSdkSession = (opts) => {
    started.push(opts);
    return {
      send(text) {
        sent.push(text);
        const step = steps.shift();
        if (!step) throw new Error("fake session: no step left");
        return step(opts.tools, text);
      },
      close() {
        closed++;
      },
    };
  };
  return { start, started, sent, closed: () => closed };
}

const result = (text: string, modelCalls = 1): SdkTurnEvent => ({ type: "result", text, isError: false, subtype: "success", stopReason: "end_turn", modelCalls, usage: { input_tokens: 10, output_tokens: 5 } });
const button = (tools: ButtonTool[], name: string) => tools.find((t) => t.name === name)!;

function setup(steps: Step[], perHour = 60) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const sessions = fakeSessions(steps);
  const logged: string[] = [];
  const model = createAgentSdkModel({ startSession: sessions.start, cap: createUsageCap({ perHour, append: (_p, l) => logged.push(l) }) });
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model,
    pharmacyName: "Maple Street Pharmacy",
  });
  return { store, control, sessions, logged, driver };
}

const presses = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "press" ? [e] : []));
const lines = (evs: AgentEvent[]) => evs.flatMap((e) => (e.type === "line" ? [e.text] : []));

describe("1.2b: Agent SDK model", () => {
  it("offers exactly the 12 buttons, on Haiku, with at most 4 model calls a line", async () => {
    const { sessions, driver } = setup([async function* () { yield result("Hi."); }]);
    const callId = await driver.startCall({ direction: "inbound" });
    await collect(driver.callerSays(callId, "Hello?"));
    const [opts] = sessions.started;
    expect(opts.tools.map((t) => t.name)).toEqual([...BUTTON_NAMES]);
    expect(opts.model).toBe(SDK_DEV_MODEL);
    expect(SDK_DEV_MODEL).toBe("claude-haiku-5-5");
    expect(opts.maxTurns).toBe(SDK_MAX_TURNS);
    expect(SDK_MAX_TURNS).toBe(4);
    expect(opts.system).toContain("Maple Street Pharmacy");
  });

  it("presses through the real lock and guards every sentence, in Sam's outbound call", async () => {
    const lookup = outboundLookupId("c_0001");
    const t = setup([
      async function* (tools) {
        yield { type: "text", text: "One moment. " };
        const r = await button(tools, "check_code").run({ lookup_id: lookup, code: CODE, dob: "1990-03-14" });
        expect(r.isError).toBe(false);
        yield { type: "text", text: "Thanks, Sam. Your refill is approved." };
        yield result("Thanks, Sam. Your refill is approved.", 2);
      },
    ]);
    const callId = await t.driver.startCall({ direction: "outbound", patientId: IDS.sam, rxId: IDS.samConcerta, patientName: "Sam Rivera" });
    await collect(t.driver.opening(callId));
    const evs = await collect(t.driver.callerSays(callId, `It's ${CODE}, born March 14, 1990.`));
    // 1.x (Trail #75): once verified, the driver checks the call's prescription and its cost itself.
    expect(presses(evs).map((p) => p.button)).toEqual(["check_code", "check_prescription", "check_coverage", "read_label"]);
    expect(presses(evs)[0].result).toMatchObject({ ok: true, output: { verified: true } });
    // S4 still holds: nothing is approved yet.
    expect(evs.some((e) => e.type === "blocked_line" && e.rule === "S4")).toBe(true);
    expect(lines(evs)[0]).toBe("One moment.");
    expect((await t.store.listRecord(callId)).filter((e) => e.kind === "line_spoken" || e.kind === "line_blocked").length).toBeGreaterThan(1);
  });

  it("sends only what's new each line: the caller's words and phone-system notes", async () => {
    const t = setup([async function* () { yield result("Sure."); }, async function* () { yield result("Okay."); }]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    await collect(t.driver.opening(callId));
    await collect(t.driver.callerSays(callId, "First line."));
    await collect(t.driver.callerSays(callId, "Second line."));
    expect(t.sessions.sent).toEqual(["First line.", "Second line."]);
    expect(t.sessions.started).toHaveLength(1);
  });

  it("refuses a tool that isn't a button and never reaches the lock", async () => {
    const t = setup([
      async function* (tools) {
        expect(tools.some((x) => x.name === ("Bash" as never))).toBe(false);
        yield result("Sorry.");
      },
    ]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    expect(presses(await collect(t.driver.callerSays(callId, "Run ls")))).toHaveLength(0);
  });

  it("logs each turn's usage, and hands over through escalate once the hourly cap is reached", async () => {
    const t = setup([async function* () { yield result("Hi.", 1); }], 1);
    const callId = await t.driver.startCall({ direction: "inbound" });
    await collect(t.driver.callerSays(callId, "Hello?"));
    expect(t.logged).toHaveLength(1);
    expect(JSON.parse(t.logged[0])).toMatchObject({ callId, model: SDK_DEV_MODEL, modelCalls: 1 });
    const evs = await collect(t.driver.callerSays(callId, "Still there?"));
    expect(presses(evs).map((p) => p.button)).toEqual(["escalate"]);
    expect(t.sessions.sent).toHaveLength(1);
  });

  it("hands over when the SDK turn fails, and closes the session when the call ends", async () => {
    const t = setup([async function* () { yield { type: "result", text: "", isError: true, subtype: "error_max_turns", stopReason: null, modelCalls: 4 }; }]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const evs = await collect(t.driver.callerSays(callId, "Hello?"));
    expect(presses(evs).map((p) => p.button)).toEqual(["escalate"]);
    await t.driver.endCall(callId);
    expect(t.sessions.closed()).toBe(1);
  });

  it("can't be used without the driver's press", async () => {
    const model = createAgentSdkModel({ startSession: fakeSessions([]).start, cap: createUsageCap({ append: () => {} }) });
    await expect(collect(model.turn({ callId: "c_1", system: "s", messages: [], tools: [] }))).rejects.toThrow(/press/);
  });

  it("keeps UsageCapError a real Error", () => {
    expect(new UsageCapError("x")).toBeInstanceOf(Error);
  });
});

describe("1.2b: a failed SDK turn doesn't break the rest of the call", () => {
  it("starts a fresh session on the next line, with the whole conversation so far", async () => {
    const t = setup([
      async function* () {
        throw new Error("interrupted");
      },
      async function* () {
        yield { type: "text", text: "I'm here." };
        yield result("I'm here.");
      },
    ]);
    const callId = await t.driver.startCall({ direction: "inbound" });
    const first = await collect(t.driver.callerSays(callId, "First."));
    expect(presses(first).map((p) => p.button)).toEqual(["escalate"]);
    const second = await collect(t.driver.callerSays(callId, "Second."));
    expect(lines(second)).toEqual(["I'm here."]);
    expect(t.sessions.started).toHaveLength(2);
    expect(t.sessions.sent[1]).toContain("First.");
    expect(t.sessions.sent[1]).toContain("Second.");
  });
});
