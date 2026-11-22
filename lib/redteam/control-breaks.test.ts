// Red-team regressions for verification and triage (Trail #86). Each probe in
// control-attacks.ts was run against main's real control layer and broke the SPEC; the test
// asserts the SAFE outcome and is marked it.fails until the fix lands. The fixer flips a case
// to a plain `it` once it holds. Never delete a case to make the gate pass.
//
// RT-C1  The code lockout is per call. Three wrong codes lock the call, but hanging up and
//        redialing gets a fresh call, a fresh code and three more guesses, and verifies at once.
// RT-C2  The failed-code signal is per call too, so redialing after wrong codes sends the
//        controlled refill to Quick check instead of Review.
// RT-C3  Signals are read once, when the refill is requested. Anything after it (self-harm or
//        overdose words, a speech-guard replacement, failed codes) never moves the queued refill
//        to Review: a crisis call leaves an Automatic refill queued, with no hold.

import { describe, expect, it } from "vitest";
import { CONTROL_PROBES } from "./control-attacks";

const probe = (id: string) => {
  const p = CONTROL_PROBES.find((x) => x.id === id);
  if (!p) throw new Error(`no probe ${id}`);
  return p;
};

describe("red team: the same-call failed-code signal still reaches Review (harness check)", () => {
  it("c.signal.same_call.baseline holds", async () => {
    expect((await probe("c.signal.same_call.baseline").run()).broke).toBe(false);
  });
});

describe("red team, open breaks (fix the control layer, then flip to it): verification and triage", () => {
  it.fails.each([
    ["RT-C1 a redial verifies a patient locked out a moment ago", "c.lockout.redial"],
    ["RT-C1 redialing gives more than three guesses against one patient", "c.lockout.redial.guesses"],
    ["RT-C2 failed codes on an earlier call don't reach the refill's lane", "c.signal.redial"],
    ["RT-C3 self-harm words after an Automatic refill don't put it on hold", "c.after_queue.crisis"],
    ["RT-C3 overdose words after a Quick check refill don't move it to Review", "c.after_queue.emergency"],
    ["RT-C3 a speech-guard replacement after the refill doesn't move it to Review", "c.after_queue.blocked_line"],
    ["RT-C3 failed codes after the refill don't move it to Review", "c.after_queue.failed_codes"],
  ])("%s", async (_finding, id) => {
    expect((await probe(id).run()).broke).toBe(false);
  });
});
