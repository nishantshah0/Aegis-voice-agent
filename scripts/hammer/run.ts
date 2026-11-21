// The two hammers. Each sequence starts from a fresh store (reset to the seed), plays
// actions, and checks every invariant after every press. Counts are real, from this run.

import type { Seed, Store } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { SEED, IDS } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { HAMMER_CODE, type Action, type HammerState } from "./actions";
import { makeChecker, type Broken } from "./invariants";

export type Start = "inbound" | "outbound_sam";

export type HammerReport = {
  kind: "exhaustive" | "random";
  sequences: number;
  presses: number;
  checks: number;
  broken: number;
  failures: { sequence: string[]; broken: Broken[] }[];
  ms: number;
};

async function begin(start: Start, seed: Seed): Promise<HammerState> {
  const store: Store = createMemoryStore(seed);
  const control = createControl({ store, makeCode: () => HAMMER_CODE, broadcastCodes: false });
  const guard = createSpeechGuard({ store });
  const safety = createSafetyCheck({ store });
  const s: HammerState = { store, control, guard, safety, callId: "", lastLookup: "lk_none", lastOrder: "o_none", presses: 0 };
  if (start === "inbound") {
    s.callId = await control.startInboundCall();
  } else {
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("the seed should allow Sam's outbound call at 10 AM");
    s.callId = started.callId;
    s.lastLookup = started.lookupId;
  }
  return s;
}

async function play(actions: Action[], start: Start, checker: ReturnType<typeof makeChecker>, seed: Seed) {
  const s = await begin(start, seed);
  const broken: Broken[] = [];
  let checks = 0;
  for (const a of actions) {
    const before = (await s.store.listRecord()).length;
    try {
      await a.run(s);
    } catch (e) {
      broken.push({ rule: "press threw", detail: `${a.label}: ${(e as Error).message}` });
      continue;
    }
    const record = await s.store.listRecord();
    const fresh = record.slice(before);
    for (const entry of fresh.length > 0 ? fresh : [undefined]) {
      broken.push(...(await checker.check(s.store, entry)));
      checks++;
    }
  }
  return { broken, presses: s.presses, checks };
}

function emptyReport(kind: HammerReport["kind"]): HammerReport {
  return { kind, sequences: 0, presses: 0, checks: 0, broken: 0, failures: [], ms: 0 };
}

async function record(report: HammerReport, seq: Action[], start: Start, checker: ReturnType<typeof makeChecker>, seed: Seed) {
  const { broken, presses, checks } = await play(seq, start, checker, seed);
  report.sequences++;
  report.presses += presses;
  report.checks += checks;
  if (broken.length > 0) {
    report.broken += broken.length;
    if (report.failures.length < 20) report.failures.push({ sequence: [start, ...seq.map((a) => a.label)], broken });
  }
}

/** Every sequence of 1 to `depth` actions, from each start. */
export async function exhaustive(alphabet: Action[], depth: number, starts: Start[] = ["inbound", "outbound_sam"], seed: Seed = SEED): Promise<HammerReport> {
  const t0 = Date.now();
  const report = emptyReport("exhaustive");
  const checker = makeChecker(seed, HAMMER_CODE);
  const indices: number[] = [];
  async function walk(level: number): Promise<void> {
    if (level > 0) {
      for (const start of starts) await record(report, indices.map((i) => alphabet[i]), start, checker, seed);
    }
    if (level === depth) return;
    for (let i = 0; i < alphabet.length; i++) {
      indices.push(i);
      await walk(level + 1);
      indices.pop();
    }
  }
  await walk(0);
  report.ms = Date.now() - t0;
  return report;
}

/** A small seeded random generator, so a failing run can be replayed. */
export function mulberry32(seedNumber: number) {
  let a = seedNumber >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` random sequences of `min` to `max` actions. */
export async function random(alphabet: Action[], count: number, opts: { min?: number; max?: number; seedNumber?: number; seed?: Seed } = {}): Promise<HammerReport> {
  const { min = 5, max = 30, seedNumber = 20261121, seed = SEED } = opts;
  const t0 = Date.now();
  const report = emptyReport("random");
  const checker = makeChecker(seed, HAMMER_CODE);
  const rand = mulberry32(seedNumber);
  for (let n = 0; n < count; n++) {
    const length = min + Math.floor(rand() * (max - min + 1));
    const seq = Array.from({ length }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    const start: Start = rand() < 0.5 ? "inbound" : "outbound_sam";
    await record(report, seq, start, checker, seed);
  }
  report.ms = Date.now() - t0;
  return report;
}

export function summary(r: HammerReport): string {
  return `${r.kind}: ${r.sequences} sequences, ${r.presses} presses, ${r.checks} checks, ${r.broken} rules broken, ${(r.ms / 1000).toFixed(1)} s`;
}
