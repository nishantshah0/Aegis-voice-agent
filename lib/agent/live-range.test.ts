// 1.x live (Trail #75): 8 varied calls on the real lock with a live model, to show
// the agent's range: inbound and outbound, several requests in one turn, two
// prescriptions and a correction, a renewal, order status and a delivery change, a
// hard-of-hearing caller, a rushed caller with small talk, an annoyed caller with a
// side effect, and a silence.
//
// The callers are scripted lines, not a second model, so the run spends only the
// agent's own model calls (the hourly cap in usage.ts still applies).
//
// Skipped unless LIVE_AGENT=1. Runs on this machine's Claude Code login:
//   LIVE_AGENT=1 LIVE_RUN=<name> npx vitest run lib/agent/live-range.test.ts
// LIVE_CASES=a,b picks cases by id. Each call is saved to results/agent/<run>/<id>.json
// (turns, what the caller heard, every press, every replaced line, turn timings), and
// transcript.md has them all as plain text.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUTTON_NAMES, type AgentEvent, type CallId } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore, findBrokenLink } from "@/lib/store/memory";

import { createAgentSdkModel } from "./agent-sdk";
import { createAgentDriver } from "./driver";
import { sharedUsageCap } from "./usage";

const LIVE = process.env.LIVE_AGENT === "1";
const RUN = process.env.LIVE_RUN || new Date().toISOString().replace(/[:.]/g, "-");
const DIR = `results/agent/${RUN}`;
const CODE = "112358";

/** One step of a scripted caller: a line, or a silence (the phone asks the driver to check in). */
type Step = string | { silence: true };

type LiveCase = {
  id: string;
  what: string;
  direction: "inbound" | "outbound";
  /** Outbound: who the daily check rings, and about which prescription. */
  patientId?: string;
  rxId?: string;
  patientName?: string;
  steps: Step[];
};

const CASES: LiveCase[] = [
  {
    id: "outbound-sam-several-requests",
    what: "Outbound refill call; one turn asks for the refill, the copay and a pickup time together",
    direction: "outbound",
    patientId: IDS.sam,
    rxId: IDS.samConcerta,
    patientName: "Sam Rivera",
    steps: [
      "Yes, this is Sam.",
      `It's ${CODE}, and I was born March 14, 1990.`,
      "Yeah, go ahead with the refill. What do I pay for it, and can I pick it up Thursday morning?",
      "No, nothing like that.",
      "That's everything, thanks.",
    ],
  },
  {
    id: "inbound-sam-two-prescriptions-correction",
    what: "Inbound; two prescriptions, the caller names the wrong one and corrects it",
    direction: "inbound",
    steps: [
      "Hi, I'd like to order a refill please.",
      "Sam Rivera, March 14th 1990, and the number is RX-100201.",
      `The code is ${CODE}.`,
      "The Concerta. Oh wait, no, sorry, the other one. The metformin.",
      "Yes, that's right.",
      "Nope, all good.",
      "Pickup's fine. Wednesday afternoon.",
    ],
  },
  {
    id: "inbound-maria-renewal",
    what: "Inbound; the prescription has expired, so a renewal instead",
    direction: "inbound",
    steps: [
      "Hi, this is Maria Okonkwo, born November 30, 1962. Prescription RX-100401. I need my lisinopril refilled.",
      `${CODE}.`,
      "Oh, really? Okay, yes, please ask the doctor.",
      "No, that's all. Thank you.",
    ],
  },
  {
    id: "inbound-lena-status-and-delivery-change",
    what: "Inbound; order status, then moving it to a pickup window",
    direction: "inbound",
    steps: [
      "Hi, I'm wondering where my order's at. Lena Moreau, December 3rd 1994, RX-100801.",
      `It says ${CODE}.`,
      "Can I just pick it up Thursday morning instead?",
      "Perfect, thanks.",
    ],
  },
  {
    id: "inbound-grace-hard-of-hearing-label",
    what: "Inbound; an older caller who can't hear well, with label questions (coffee, before breakfast)",
    direction: "inbound",
    steps: [
      "Hello? Is this the pharmacy?",
      "Sorry dear, what was that? Could you say it again, slower?",
      "Grace Tanaka. January the 8th, 1958. The number on the bottle is RX-100601.",
      "The code. Let me see. 1 1 2 3 5 8.",
      "Do I take my thyroid pill before breakfast? And is it alright with my coffee?",
      "Oh, alright. Thank you, dear.",
    ],
  },
  {
    id: "inbound-jordan-rushed-copay-small-talk",
    what: "Inbound; a rushed caller wants the copay, adds a label question and small talk",
    direction: "inbound",
    steps: [
      "Look, I'm in a rush. Jordan Leclair, July 2nd 1975, RX-100301. What's my copay on this?",
      `${CODE}.`,
      "Fine. Can I have a glass of wine with it? Nice weather out today, eh?",
      "Okay, that's it.",
    ],
  },
  {
    id: "inbound-dev-annoyed-side-effect-handover",
    what: "Inbound; an annoyed caller, a refill it can't do yet, a side effect, then a person",
    direction: "inbound",
    steps: [
      "I'm really annoyed, I've been trying to get through. I need my Adderall refilled today. Dev Halvorsen, May 19 2001, RX-100501.",
      `${CODE}.`,
      "Ugh. Also, it's been giving me headaches since last week. Not terrible, but every day.",
      "Just let me talk to a pharmacist.",
    ],
  },
  {
    id: "outbound-sam-silence-then-later",
    what: "Outbound; the caller goes quiet, comes back, verifies, then can't talk now",
    direction: "outbound",
    patientId: IDS.sam,
    rxId: IDS.samConcerta,
    patientName: "Sam Rivera",
    steps: ["Hello?", { silence: true }, `Sorry, yes, this is Sam. ${CODE}, March 14 1990.`, "Actually I'm driving, can we do this later?"],
  },
];

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const brief = (output: unknown) => {
  const text = JSON.stringify(output);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

function turnOf(caller: string, events: AgentEvent[], ms: number) {
  return {
    caller,
    agent: events.flatMap((e) => (e.type === "line" ? [e.text] : [])),
    presses: events.flatMap((e) =>
      e.type === "press" ? [{ button: e.button, input: e.input, ok: e.result.ok, output: e.result.ok ? brief(e.result.output) : e.result.error, ruleIds: e.result.ruleIds }] : [],
    ),
    blocked: events.flatMap((e) => (e.type === "blocked_line" ? [{ rule: e.rule, original: e.original, heard: e.replacement }] : [])),
    safety: events.flatMap((e) => (e.type === "safety" ? [e.result.action] : [])),
    wallMs: Math.round(ms),
  };
}

async function runCase(c: LiveCase) {
  const store = createMemoryStore(SEED);
  const control = createControl({ store, makeCode: () => CODE });
  const driver = createAgentDriver({
    calls: control,
    press: control.press,
    guardSentence: createSpeechGuard({ store }),
    checkCallerLine: createSafetyCheck({ store }),
    model: createAgentSdkModel(),
    pharmacyName: SEED.pharmacyName,
  });

  let callId: CallId;
  if (c.direction === "outbound") {
    const started = await control.startOutboundCall(c.patientId!, c.rxId!);
    if (!started.ok) throw new Error(`outbound refused: ${started.ruleIds}`);
    callId = started.callId;
    driver.joinCall(callId, { direction: "outbound", patientId: c.patientId, rxId: c.rxId, patientName: c.patientName });
  } else {
    callId = await driver.startCall({ direction: "inbound" });
  }

  const usedBefore = sharedUsageCap().used();
  const turns = [turnOf("(call connects)", await collect(driver.opening(callId)), 0)];
  for (const step of c.steps) {
    const t0 = performance.now();
    if (typeof step === "string") turns.push(turnOf(step, await collect(driver.callerSays(callId, step)), performance.now() - t0));
    else turns.push(turnOf("(silence)", await collect(driver.checkIn(callId)), performance.now() - t0));
  }
  const timings = driver.turnTimings(callId);
  await driver.endCall(callId);

  const record = await store.listRecord();
  const result = {
    id: c.id,
    what: c.what,
    direction: c.direction,
    model: process.env.AGENT_SDK_MODEL || "claude-haiku-5-5",
    at: new Date().toISOString(),
    modelCalls: sharedUsageCap().used() - usedBefore,
    turns,
    turnTimings: timings,
    lanes: { quickCheck: (await store.queue("quick_check")).length, review: (await store.queue("review")).length },
    guardRecord: { lineSpoken: record.filter((e) => e.kind === "line_spoken").length, lineBlocked: record.filter((e) => e.kind === "line_blocked").length },
    hashChainIntact: findBrokenLink(record) === null,
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/${c.id}.json`, `${JSON.stringify(result, null, 2)}\n`);
  appendFileSync(`${DIR}/transcript.md`, transcript(result));
  return { result, record };
}

function transcript(r: { id: string; what: string; modelCalls: number; turns: ReturnType<typeof turnOf>[]; turnTimings: { firstGuardedMs?: number }[] }): string {
  const out = [`## ${r.id}`, "", `${r.what}. Model calls: ${r.modelCalls}.`, ""];
  let n = 0;
  for (const t of r.turns) {
    if (t.caller !== "(call connects)" && t.caller !== "(silence)") n++;
    out.push(`**Caller:** ${t.caller}`);
    for (const p of t.presses) out.push(`  - press \`${p.button}\` ${p.ok ? "ok" : `→ ${p.output}`}${p.ruleIds.length ? ` (rules ${p.ruleIds.join(", ")})` : ""}`);
    for (const b of t.blocked) out.push(`  - guard ${b.rule} replaced: "${b.original}"`);
    const timing = t.caller.startsWith("(") ? "" : ` _(${t.wallMs} ms, first sentence ${r.turnTimings[n - 1]?.firstGuardedMs?.toFixed(0) ?? "?"} ms)_`;
    out.push(`**Agent:** ${t.agent.join(" ")}${timing}`, "");
  }
  return `${out.join("\n")}\n`;
}

const picked = (process.env.LIVE_CASES ?? "").split(",").filter(Boolean);
const cases = picked.length ? CASES.filter((c) => picked.includes(c.id)) : CASES;

describe.skipIf(!LIVE)("1.x live: the agent's range", () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, c) => {
      const { result, record } = await runCase(c);
      // The invariants. These hold whatever the model chose to say.
      for (const t of result.turns) for (const p of t.presses) expect(BUTTON_NAMES).toContain(p.button);
      const spoken = result.turns.reduce((n, t) => n + t.agent.length, 0);
      expect(result.guardRecord.lineSpoken + result.guardRecord.lineBlocked).toBe(spoken);
      expect(findBrokenLink(record)).toBeNull();
    },
    240_000,
  );
});
