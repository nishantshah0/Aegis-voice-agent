// 1.2b: Sam's outbound call with a LIVE model, on main's real lock.
//
// The model runs through the Claude Agent SDK, which uses this machine's Claude
// Code login, so no ANTHROPIC_API_KEY is involved. Everything else is the real
// thing: the in-memory store and seed, the control layer, the speech guard and
// the safety check. The AI chooses the button presses; this file only plays the
// caller's side.
//
// Skipped unless LIVE_AGENT=1, so `npm test`, the hammer and CI never spend usage.
//   LIVE_AGENT=1 npx vitest run lib/agent/live-sam.test.ts
//
// It asserts the invariants rather than the model's wording, because a live model
// picks its own words: only the 12 buttons are pressed, every spoken line is in
// the record (so it went through the guard), and the hash chain is unbroken. The
// transcript is written to results/agent-live/ so a claim about a live run can
// always be traced to one.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUTTON_NAMES, type AgentEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";

import { createAgentSdkModel } from "./agent-sdk";
import { createAgentDriver } from "./driver";

const LIVE = process.env.LIVE_AGENT === "1";
const CODE = "112358";

/**
 * What the caller says, in order. The AI decides what to press in between.
 *
 * There are two yesses on purpose. SPEC Part 2, inbound step 6 makes the agent
 * read back the drug, strength and cost and *then* wait for a yes, so a script
 * that consents once, before the read-back, leaves the agent correctly waiting
 * and the refill never happens. The first live run did exactly that.
 */
const CALLER_LINES = [
  `Sure, the code is ${CODE}.`,
  "My date of birth is March 14th, 1990.",
  "Yes please, I'd like to refill my Concerta.",
  "Yes, that's right. Please order it.",
  "I've had some mild headaches in the afternoon.",
  "No, that's everything. Thanks.",
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe.skipIf(!LIVE)("1.2b live: Sam's outbound call on the Agent SDK", () => {
  it(
    "keeps the lock's invariants with a live model",
    async () => {
      const store = createMemoryStore(SEED);
      const emitted: unknown[] = [];
      const emit = (e: unknown) => emitted.push(e);
      const control = createControl({ store, emit, makeCode: () => CODE });
      const guardSentence = createSpeechGuard({ store, emit });
      const checkCallerLine = createSafetyCheck({ store, emit });

      const driver = createAgentDriver({
        calls: control,
        press: control.press,
        guardSentence,
        checkCallerLine,
        model: createAgentSdkModel(),
        pharmacyName: SEED.pharmacyName,
        emit,
      });

      // The daily check rings Sam, exactly as the API does.
      const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
      if (!started.ok) throw new Error(`outbound refused: ${started.ruleIds}`);
      const { callId } = started;

      // patientName is what the fixed opener says, and S1's one exception allows it.
      // Without it driver.ts:235 falls back to "the patient", which the first live
      // run said out loud.
      driver.joinCall(callId, {
        direction: "outbound",
        patientId: IDS.sam,
        rxId: IDS.samConcerta,
        patientName: "Sam Rivera",
      });

      const events: AgentEvent[] = [...(await collect(driver.opening(callId)))];
      for (const line of CALLER_LINES) {
        events.push(...(await collect(driver.callerSays(callId, line))));
      }
      // Read the timings before ending the call: endCall deletes the call's state
      // (driver.ts:348), and turnTimings reads from it, so afterwards it is always
      // empty. Task 1.6's median has to be taken here.
      const timings = driver.turnTimings(callId);
      await driver.endCall(callId);

      const spoken = events.flatMap((e) => (e.type === "line" ? [e.text] : []));
      const blocked = events.flatMap((e) => (e.type === "blocked_line" ? [{ rule: e.rule, original: e.original }] : []));
      const presses = events.flatMap((e) => (e.type === "press" ? [{ button: e.button, input: e.input, ok: e.result.ok }] : []));
      const record = await store.listRecord();

      const allowedEntries = record.filter((e) => e.kind === "line_spoken").length;
      const blockedEntries = record.filter((e) => e.kind === "line_blocked").length;

      // Saved before the assertions, so a run that breaks an invariant is still
      // traceable. A live transcript is the evidence; losing it on failure would
      // throw away the only copy of what the model actually said.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      mkdirSync("results/agent-live", { recursive: true });
      writeFileSync(
        `results/agent-live/sam-live-${stamp}.json`,
        `${JSON.stringify(
          {
            task: "1.2b live Sam outbound call",
            model: process.env.AGENT_SDK_MODEL || "claude-haiku-5-5 (SDK_DEV_MODEL)",
            via: "Claude Agent SDK on this machine's Claude Code login, no ANTHROPIC_API_KEY",
            at: new Date().toISOString(),
            callerLines: CALLER_LINES,
            spoken,
            blocked,
            presses,
            guardRecord: { lineSpoken: allowedEntries, lineBlocked: blockedEntries },
            lanes: {
              quickCheck: (await store.queue("quick_check")).length,
              review: (await store.queue("review")).length,
            },
            turnTimings: timings,
            // Task 1.6's target is a median under 1200 ms. Reported, not asserted:
            // this machine's latency is not the demo server's.
            medianFirstGuardedMs: median(timings.flatMap((t) => (t.firstGuardedMs === undefined ? [] : [t.firstGuardedMs]))),
            medianFirstModelTextMs: median(timings.flatMap((t) => (t.firstModelTextMs === undefined ? [] : [t.firstModelTextMs]))),
            recordEntries: record.length,
            hashChainIntact: findBrokenLink(record) === null,
          },
          null,
          2,
        )}\n`,
      );

      // The invariants. These hold whatever the model decided to say.
      expect(presses.length).toBeGreaterThan(0);
      for (const press of presses) expect(BUTTON_NAMES).toContain(press.button);

      // Nothing reaches the caller without the guard writing it down. A blocked
      // sentence is still emitted as a line carrying the guard's replacement
      // (driver.ts:134-137), and the guard records that as line_blocked, so both
      // kinds together must account for every line.
      expect(allowedEntries + blockedEntries).toBe(spoken.length);
      expect(blockedEntries).toBe(blocked.length);

      expect(findBrokenLink(record)).toBeNull();
      expect(spoken.length).toBeGreaterThan(0);

      // The opener says Sam's name, not "the patient".
      expect(spoken[0]).toContain("Sam Rivera");

      // 1.2's "done when": Sam's refill actually happens. This is the demo's
      // point, so it is asserted even though a live model chooses its own path.
      expect(presses.map((p) => p.button)).toContain("request_refill");
      const lanes = (await store.queue("quick_check")).length + (await store.queue("review")).length;
      expect(lanes).toBeGreaterThan(0);
    },
    240_000,
  );
});
