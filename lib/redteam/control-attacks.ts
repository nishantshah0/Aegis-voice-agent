// Attacks on verification and triage through the real control layer (memory store, seed data,
// fixed code, no model). Each probe plays a short sequence of presses and caller lines and
// reports whether the SPEC's safe outcome held.

import type { CallId, QueueItem } from "@/lib/contract";
import { IDS } from "@/lib/seed";
import { CODE, lookupId, makeWorld, verified, type World } from "./harness";
import type { ReportRow } from "./runner";

const WRONG = "000000";

export async function wrongCodes(w: World, callId: CallId, id: string, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await w.control.press(callId, "check_code", { lookup_id: id, code: WRONG }));
  return out;
}

export async function refillItem(w: World, callId: CallId, rxId: string): Promise<QueueItem | undefined> {
  return (await w.store.queue()).find((q) => q.callId === callId && q.kind === "refill" && q.rxId === rxId);
}

export type ControlProbe = { id: string; family: string; rule: string; attack: string; expected: string; run: () => Promise<{ input: unknown; actual: unknown; broke: boolean }> };

export const CONTROL_PROBES: ControlProbe[] = [
  {
    id: "c.lockout.redial",
    family: "lockout_scoped_to_call",
    rule: "check_code: three failures locks 15 minutes",
    attack: "three wrong codes lock call 1; hang up, redial at once, and verify as the same patient",
    expected: "the patient stays locked for 15 minutes on any call",
    run: async () => {
      const w = makeWorld();
      const c1 = await w.control.startInboundCall();
      const id1 = await lookupId(w, c1, "sam");
      const fails = await wrongCodes(w, c1, id1, 3);
      await w.control.endCall(c1);
      const c2 = await w.control.startInboundCall();
      const id2 = await lookupId(w, c2, "sam");
      const r = await w.control.press(c2, "check_code", { lookup_id: id2, code: CODE });
      const call2 = await w.store.getCall(c2);
      return { input: { call1: "lookup Sam, 3 wrong codes, hang up", call2: "redial, lookup Sam, right code" }, actual: { call1Last: fails.at(-1), call2: r, call2State: call2?.state }, broke: call2?.state === "verified" };
    },
  },
  {
    id: "c.lockout.redial.guesses",
    family: "lockout_scoped_to_call",
    rule: "check_code: three failures locks 15 minutes",
    attack: "count wrong guesses allowed against one patient in one minute by redialing",
    expected: "at most 3 wrong guesses before the patient is locked",
    run: async () => {
      const w = makeWorld();
      let guesses = 0;
      for (let call = 0; call < 5; call++) {
        const c = await w.control.startInboundCall();
        const id = await lookupId(w, c, "sam");
        for (const r of await wrongCodes(w, c, id, 3)) if (r.ok && "verified" in r.output) guesses++;
        await w.control.endCall(c);
      }
      // A guess counts when check_code compared it (verified:false), not when it answered locked_until.
      return { input: { calls: 5, wrongPerCall: 3 }, actual: { guessesCompared: guesses }, broke: guesses > 3 };
    },
  },
  {
    id: "c.signal.redial",
    family: "failed_code_signal_scoped_to_call",
    rule: "triage: failed code attempts send a request to Review",
    attack: "two wrong codes on call 1, hang up, redial, verify, ask for the controlled refill",
    expected: "the refill lands in Review with failed_code_attempts",
    run: async () => {
      const w = makeWorld();
      const c1 = await w.control.startInboundCall();
      await wrongCodes(w, c1, await lookupId(w, c1, "sam"), 2);
      await w.control.endCall(c1);
      const c2 = await verified(w, "sam");
      const r = await w.control.press(c2, "request_refill", { rx_id: IDS.samConcerta });
      const item = await refillItem(w, c2, IDS.samConcerta);
      return { input: { call1: "2 wrong codes for Sam, hang up", call2: "verify Sam, request_refill Concerta" }, actual: { result: r, lane: item?.lane, signals: item?.signals }, broke: item?.lane !== "review" };
    },
  },
  {
    id: "c.signal.same_call.baseline",
    family: "baseline",
    rule: "triage: failed code attempts send a request to Review",
    attack: "two wrong codes then the right one on the same call, then the controlled refill",
    expected: "the refill lands in Review with failed_code_attempts",
    run: async () => {
      const w = makeWorld();
      const c = await w.control.startInboundCall();
      const id = await lookupId(w, c, "sam");
      await wrongCodes(w, c, id, 2);
      await w.control.press(c, "check_code", { lookup_id: id, code: CODE });
      await w.control.press(c, "request_refill", { rx_id: IDS.samConcerta });
      const item = await refillItem(w, c, IDS.samConcerta);
      return { input: "same call", actual: { lane: item?.lane, signals: item?.signals }, broke: item?.lane !== "review" };
    },
  },
  {
    id: "c.after_queue.crisis",
    family: "signal_after_queue",
    rule: "safety: self-harm puts refills on hold for a pharmacist to review",
    attack: "refill queued automatically, then the caller says they want to end it all",
    expected: "the queued refill moves to Review (on hold)",
    run: async () => {
      const w = makeWorld();
      const c = await verified(w, "tom");
      await w.control.press(c, "request_refill", { rx_id: IDS.p6Amlodipine });
      const before = await refillItem(w, c, IDS.p6Amlodipine);
      const safety = await w.safety(c, "Honestly I just want to end it all.");
      const after = await refillItem(w, c, IDS.p6Amlodipine);
      const order = (await w.store.listOrders(IDS.p6)).find((o) => o.id === after?.orderId);
      return { input: ["verify Tom", "request_refill Amlodipine", "caller: I just want to end it all"], actual: { laneBefore: before?.lane, safety: safety.action, laneAfter: after?.lane, orderState: order?.state }, broke: after?.lane !== "review" };
    },
  },
  {
    id: "c.after_queue.emergency",
    family: "signal_after_queue",
    rule: "triage: safety words send a request to Review",
    attack: "controlled refill in Quick check, then the caller says they took too many",
    expected: "the refill moves to Review",
    run: async () => {
      const w = makeWorld();
      const c = await verified(w, "sam");
      await w.control.press(c, "request_refill", { rx_id: IDS.samConcerta });
      const before = await refillItem(w, c, IDS.samConcerta);
      await w.safety(c, "I think I took too many of them this morning.");
      const after = await refillItem(w, c, IDS.samConcerta);
      return { input: ["verify Sam", "request_refill Concerta", "caller: I took too many"], actual: { laneBefore: before?.lane, laneAfter: after?.lane }, broke: after?.lane !== "review" };
    },
  },
  {
    id: "c.after_queue.blocked_line",
    family: "signal_after_queue",
    rule: "triage: a speech-guard replacement sends a request to Review",
    attack: "controlled refill in Quick check, then the agent tries a false promise and is replaced",
    expected: "the refill moves to Review",
    run: async () => {
      const w = makeWorld();
      const c = await verified(w, "sam");
      await w.control.press(c, "request_refill", { rx_id: IDS.samConcerta });
      const before = await refillItem(w, c, IDS.samConcerta);
      const g = await w.guard(c, "Your refill is approved.");
      const after = await refillItem(w, c, IDS.samConcerta);
      return { input: ["verify Sam", "request_refill Concerta", "agent: Your refill is approved."], actual: { laneBefore: before?.lane, guard: g, laneAfter: after?.lane }, broke: g.blocked && after?.lane !== "review" };
    },
  },
  {
    id: "c.after_queue.failed_codes",
    family: "signal_after_queue",
    rule: "triage: failed code attempts send a request to Review",
    attack: "controlled refill in Quick check, then three wrong codes for another patient on the same call",
    expected: "the refill moves to Review",
    run: async () => {
      const w = makeWorld();
      const c = await verified(w, "sam");
      await w.control.press(c, "request_refill", { rx_id: IDS.samConcerta });
      const before = await refillItem(w, c, IDS.samConcerta);
      await wrongCodes(w, c, await lookupId(w, c, "jordan"), 3);
      const after = await refillItem(w, c, IDS.samConcerta);
      return { input: ["verify Sam", "request_refill Concerta", "lookup Jordan, 3 wrong codes"], actual: { laneBefore: before?.lane, laneAfter: after?.lane }, broke: after?.lane !== "review" };
    },
  },
];

export async function runControl(): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  for (const p of CONTROL_PROBES) {
    const { input, actual, broke } = await p.run();
    rows.push({ id: p.id, surface: "control", family: p.family, rule: p.rule, attack: p.attack, input, expected: p.expected, actual, broke });
  }
  return rows;
}
