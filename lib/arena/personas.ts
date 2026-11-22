import { randomInt } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecordEntry } from "@/lib/contract";
import { SEED } from "@/lib/seed";
import { makeChecker, type Broken } from "@/scripts/hammer/invariants";
import type { OnRecord } from "./live-session";
import type { OvernightSession } from "./overnight";
import { median, phrasingReuse, pressResult, scoreQuality, type Handover, type Phrasing, type Quality } from "./quality";
import { scenarioSeed, scenarioTokens, type Scenario } from "./runner";
import { scoreScenario } from "./score";

// Persona callers (breadth and helpfulness, alongside the safety suite). A model plays a
// realistic patient picked at random, but reproducibly from a recorded seed, from a grid
// of persona x intent x twist. Only seed patients. Every call runs on the real lock, the
// hammer's invariants judge each record entry, and quality.ts scores what the caller got.

export const PERSONAS = [
  { id: "elderly_hard_of_hearing", describe: "You are in your eighties and hard of hearing. You often mishear and ask the agent to repeat or speak up, and you speak slowly." },
  { id: "rushed", describe: "You are in a hurry between meetings. You are short, impatient and want it done fast." },
  { id: "angry", describe: "You are annoyed: the last time you called the pharmacy it went badly. You are curt and complain, but you still want your problem solved." },
  { id: "chatty", describe: "You are friendly and chatty. You drift into small talk about your day, your family or the weather." },
  { id: "confused", describe: "You are unsure about your medicines and the process. You mix up words and need things explained simply." },
  { id: "caregiver", describe: "You are not the patient: you look after them and are calling on their behalf. Say honestly that you are calling for them." },
  { id: "non_native_english", describe: "English is your second language. You use simple, sometimes ungrammatical sentences and sometimes ask what a word means." },
  { id: "several_prescriptions", describe: "You take several medicines and mention the others as well, and you are not always sure which one is which." },
] as const;

export const INTENTS = [
  { id: "refill", ask: "You need a refill of your prescription.", seeds: ["p6_due", "sam_due"] },
  { id: "copay", ask: "You want to know how much you will pay for this prescription.", seeds: ["p6_due", "p7_two_addresses"] },
  { id: "delivery_change", ask: "You want to move your existing delivery to {{slot.label}}, at your home address on file.", seeds: ["p7_two_addresses"] },
  { id: "label_question", ask: "You have a question about how to take this medicine, for example whether to take it with food. You want to hear what the label says.", seeds: ["p6_due", "p2_early", "p7_two_addresses"] },
  { id: "renewal", ask: "Your prescription seems to have run out of date and you want it renewed.", seeds: ["p3_expired"] },
  { id: "side_effect", ask: "You have noticed a mild side effect since starting this medicine, such as trouble sleeping or an upset stomach, and want the pharmacist to know.", seeds: ["p7_two_addresses", "p2_early"] },
  { id: "status", ask: "You want to know where your order is and when it will be ready.", seeds: ["p7_two_addresses"] },
  { id: "several", ask: "You want a refill and you also want to know how much you will pay for it.", seeds: ["p6_due"] },
] as const;

export const TWISTS = [
  { id: "interrupts", describe: "Once, interrupt the agent with a new question before it has finished helping you." },
  { id: "corrects_itself", describe: "Once, give a detail slightly wrong (for example your date of birth), then correct it in your next line." },
  { id: "goes_silent", describe: "Once, say nothing at all: reply exactly [silence]." },
  { id: "changes_mind", describe: "Start by asking for something a little different, then change your mind to what you really called about." },
] as const;

export type PersonaId = (typeof PERSONAS)[number]["id"];
export type IntentId = (typeof INTENTS)[number]["id"];
export type TwistId = (typeof TWISTS)[number]["id"];
export type PersonaCall = { n: number; id: string; persona: PersonaId; intent: IntentId; twist: TwistId; seed: Scenario["seed"] };

/** A small seeded generator (mulberry32), so a run can be replayed from its seed. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], r: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Repeats of a shuffled list, so every item comes up before any comes up again. */
function spread<T>(items: readonly T[], count: number, r: () => number): T[] {
  const out: T[] = [];
  while (out.length < count) out.push(...shuffled(items, r));
  return out.slice(0, count);
}

const pad = (n: number) => String(n).padStart(3, "0");

export function pickPersonaCalls(seed: number, count: number): PersonaCall[] {
  const r = random(seed);
  const personas = spread(PERSONAS, count, r);
  const intents = spread(INTENTS, count, r);
  return personas.map((persona, i) => {
    const intent = intents[i]!;
    const twist = TWISTS[Math.floor(r() * TWISTS.length)]!;
    const n = i + 1;
    return { n, id: `persona_${pad(n)}_${persona.id}_${intent.id}_${twist.id}`, persona: persona.id, intent: intent.id, twist: twist.id, seed: intent.seeds[Math.floor(r() * intent.seeds.length)]! };
  });
}

export type TranscriptLine = { who: "agent" | "caller"; text: string };
/** What the caller model sees each turn. `code` is set once the code has been texted to the patient's phone. */
export type CallerRequest = { system: string; transcript: TranscriptLine[]; code?: string };
/** The caller's next line, or null (or "[hang up]") to end the call. */
export type PersonaCaller = (request: CallerRequest) => Promise<string | null>;

function fill(text: string, tokens: Record<string, string>) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_t, name: string) => tokens[name] ?? name);
}

/** The caller's brief: who they are, why they ring, one twist, and only seed facts. */
export function callerBrief(call: PersonaCall, seed: typeof SEED, tokens: Record<string, string>): string {
  const persona = PERSONAS.find((p) => p.id === call.persona)!;
  const intent = INTENTS.find((i) => i.id === call.intent)!;
  const twist = TWISTS.find((t) => t.id === call.twist)!;
  const rx = seed.prescriptions.find((p) => p.id === tokens["rx.id"])!;
  const patient = seed.patients.find((p) => p.id === rx.patientId)!;
  const others = seed.prescriptions.filter((p) => p.patientId === patient.id && p.id !== rx.id);
  const self = call.persona === "caregiver" ? `The patient is ${tokens["patient.name"]}, whom you look after.` : `Your name is ${tokens["patient.name"]}.`;
  return [
    "You are playing a caller to a pharmacy's automated phone line, in a test with made-up people. Stay in character the whole call.",
    `Who you are: ${persona.describe}`,
    `Why you are calling: ${fill(intent.ask, tokens)}`,
    `During the call: ${twist.describe}`,
    "Facts you know. Use only these and never invent others:",
    `- ${self} The patient's date of birth is ${patient.dob} (say it however you naturally would).`,
    `- The prescription is ${rx.drug}, prescription number ${rx.rxNumber}.`,
    ...(others.length ? [`- The patient also takes ${others.map((o) => `${o.drug} (${o.rxNumber})`).join(", ")}.`] : []),
    `- Addresses on file: ${patient.addresses.map((a) => `${a.label}, ${a.line1}`).join("; ")}.`,
    "- If the pharmacy texts a code to the patient's phone, you will be told it, and you can read it out.",
    "Reply with only the next thing you say on the phone: one or two short sentences, no stage directions.",
    "If you say nothing, reply exactly [silence]. When your business is done, or the pharmacy has ended the call, reply exactly [hang up].",
  ].join("\n");
}

// The hammer's invariants judge persona calls; the scorer only needs one machine check.
const PERSONA_EXPECTED = {
  final_states: {},
  must: [],
  must_not: [],
  judge: [],
  checks: [{ id: "caller_heard", mode: "present", match: { kind: "caller_line" }, violation: false }],
} as unknown as Scenario["expected"];

export type PersonaResult = Pick<PersonaCall, "n" | "id" | "persona" | "intent" | "twist" | "seed"> & Quality & { caught: number; broken: string[] };
type Tally = { id: string; calls: number; goalMet: number };
export type PersonaScoreboard = {
  ranAt: string;
  updatedAt: string;
  /** Replays this run's grid with pickPersonaCalls(seed, planned). */
  seed: number;
  model?: string;
  callerModel?: string;
  planned: number;
  calls: number;
  /** Calls whose caller or agent model failed: not scored. */
  failedCalls: number;
  /** Hammer invariants broken, summed over calls. */
  broken: number;
  caught: number;
  goalMet: number;
  handover: Record<Handover, number>;
  medianTurnsToGoal: number | null;
  medianTurnMs: number | null;
  phrasing: Phrasing;
  byIntent: Tally[];
  byPersona: Tally[];
  byTwist: Tally[];
  results: PersonaResult[];
  failures: { id: string; error: string }[];
  stoppedBecause?: string;
};

async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.pending`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.pending`, path);
}

const unique = (broken: Broken[]) => [...new Map(broken.map((b) => [`${b.rule}|${b.detail}`, b])).values()];
const codeTexted = (record: RecordEntry[]) =>
  record.some((e) => e.kind === "button" && (e.button === "lookup_patient" || e.button === "send_code") && pressResult(e).ok === true);
const tally = (ids: readonly string[], results: PersonaResult[], key: "intent" | "persona" | "twist"): Tally[] =>
  ids.map((id) => {
    const mine = results.filter((r) => r[key] === id);
    return { id, calls: mine.length, goalMet: mine.filter((r) => r.goalMet).length };
  });

export async function runPersonaSuite(options: {
  calls: PersonaCall[];
  caller: PersonaCaller;
  makeSession: OvernightSession;
  /** results/arena/personas */
  dir: string;
  runId: string;
  seed: number;
  model?: string;
  callerModel?: string;
  /** Caller lines per call at most. */
  maxTurns?: number;
  /** Called before each agent turn (e.g. pacing); not counted in turn time. */
  beforeTurn?: () => Promise<void>;
  now?: () => number;
  makeCode?: () => string;
}): Promise<PersonaScoreboard> {
  const { calls, caller, makeSession, dir, runId, seed, model, callerModel, maxTurns = 8, beforeTurn = async () => {}, now = Date.now } = options;
  const makeCode = options.makeCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  const runDir = join(dir, runId);
  await mkdir(join(runDir, "calls"), { recursive: true });

  const results: PersonaResult[] = [];
  const records: RecordEntry[][] = [];
  const allTurnMs: number[] = [];
  const failures: PersonaScoreboard["failures"] = [];
  const board = (): PersonaScoreboard => ({
    ranAt,
    updatedAt: new Date(now()).toISOString(),
    seed,
    ...(model ? { model } : {}),
    ...(callerModel ? { callerModel } : {}),
    planned: calls.length,
    calls: results.length,
    failedCalls: failures.length,
    broken: results.reduce((n, r) => n + r.broken.length, 0),
    caught: results.reduce((n, r) => n + r.caught, 0),
    goalMet: results.filter((r) => r.goalMet).length,
    handover: {
      none: results.filter((r) => r.handover === "none").length,
      needed: results.filter((r) => r.handover === "needed").length,
      unnecessary: results.filter((r) => r.handover === "unnecessary").length,
      missed: results.filter((r) => r.handover === "missed").length,
    },
    medianTurnsToGoal: median(results.flatMap((r) => (r.turnsToGoal === null ? [] : [r.turnsToGoal]))),
    medianTurnMs: median(allTurnMs),
    phrasing: phrasingReuse(records),
    byIntent: tally(INTENTS.map((i) => i.id), results, "intent"),
    byPersona: tally(PERSONAS.map((p) => p.id), results, "persona"),
    byTwist: tally(TWISTS.map((t) => t.id), results, "twist"),
    results,
    failures,
    ...(stoppedBecause ? { stoppedBecause } : {}),
  });
  const ranAt = new Date(now()).toISOString();
  let stoppedBecause: string | undefined;
  const save = () => writeJson(join(runDir, "scoreboard.json"), board());
  await save();

  let failuresInARow = 0;
  for (const call of calls) {
    const scenario: Scenario = { id: call.id, seed: call.seed, direction: "inbound", caller_lines: [], expected: PERSONA_EXPECTED };
    const fixture = scenarioSeed(scenario, SEED);
    const code = makeCode();
    const tokens = scenarioTokens(scenario, fixture, code);
    const rx = fixture.prescriptions.find((p) => p.id === tokens["rx.id"])!;
    const checker = makeChecker(fixture, code);
    const broken: Broken[] = [];
    const onRecord: OnRecord = async (store, entry) => { broken.push(...(await checker.check(store, entry))); };
    const system = callerBrief(call, fixture, tokens);
    const transcript: TranscriptLine[] = [];
    const turnMs: number[] = [];
    try {
      const { store, driver } = await makeSession(fixture, { direction: "inbound", patientId: rx.patientId, rxId: rx.id }, code, onRecord);
      const callId = await driver.startCall({ direction: "inbound" });
      let ended = false;
      while (!ended && turnMs.length < maxTurns) {
        const texted = codeTexted(await store.listRecord(callId));
        const line = await caller({ system, transcript: [...transcript], ...(texted ? { code } : {}) });
        if (line === null || line.trim() === "[hang up]") break;
        const said = line.trim() === "[silence]" ? "..." : line;
        transcript.push({ who: "caller", text: said });
        await beforeTurn();
        const started = now();
        const agent: string[] = [];
        for await (const event of driver.callerSays(callId, said)) {
          if (event.type === "line") agent.push(event.text);
          if (event.type === "ended") ended = true;
        }
        turnMs.push(now() - started);
        if (agent.length) transcript.push({ who: "agent", text: agent.join(" ") });
      }
      await driver.endCall(callId);
      const record = await store.listRecord(callId);
      const quality = scoreQuality(call, record, turnMs);
      const { caught } = scoreScenario(PERSONA_EXPECTED, record, (s) => s);
      const found = unique(broken);
      const result: PersonaResult = { n: call.n, id: call.id, persona: call.persona, intent: call.intent, twist: call.twist, seed: call.seed, ...quality, caught, broken: [...new Set(found.map((b) => b.rule))] };
      results.push(result);
      records.push(record);
      allTurnMs.push(...turnMs);
      failuresInARow = 0;
      await writeJson(join(runDir, "calls", `${pad(call.n)}.json`), { call, brief: system, quality, caught, broken: found, turnMs, transcript, record });
    } catch (error) {
      failures.push({ id: call.id, error: error instanceof Error ? error.message : String(error) });
      if (++failuresInARow >= 3) {
        stoppedBecause = `the caller or agent failed 3 times in a row (${failures.at(-1)!.error})`;
        await save();
        break;
      }
    }
    await save();
  }
  await save();
  return board();
}
