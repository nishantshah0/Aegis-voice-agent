// 4.3 (Trail #32): the lock fails closed. Codes stay off the stream unless a caller of
// createControl asks for them, and a refuse or route card can't be skipped because the
// context is missing a field it reads.
import { describe, expect, it } from "vitest";
import type { Call, CardCondition, RuleCard, RuleContext, StreamEvent } from "@/lib/contract";
import { STARTING_CARDS } from "@/lib/contract";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";
import { buildContext } from "./context";
import { evaluate } from "./engine";
import { CODE_SENT_TEXT, createControl } from "./press";

describe("codes are off the stream by default", () => {
  it("createControl without broadcastCodes never puts the digits in an event", async () => {
    const store = createMemoryStore(SEED);
    const events: StreamEvent[] = [];
    const control = createControl({ store, emit: (e) => events.push(e), makeCode: () => "246802" });
    const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
    if (!started.ok) throw new Error("rule 7 refused Sam");
    await control.press(started.callId, "send_code", { lookup_id: started.lookupId });
    const phone = events.filter((e) => e.type === "phone" && e.kind === "code");
    expect(phone).toHaveLength(1);
    expect(phone[0]).toMatchObject({ text: CODE_SENT_TEXT });
    expect(JSON.stringify(events)).not.toContain("246802");
    expect(await control.codeFor(started.callId)).toBe("246802");
  });
});

/** Every context field a condition reads, its value's field and minus included. */
function fieldsOf(cond: CardCondition): string[] {
  const v = cond.value;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return [cond.field];
  return [cond.field, v.field, ...(typeof v.minus === "string" ? [v.minus] : [])];
}

describe("every field a live card reads is in the context", () => {
  const calls: (Call | undefined)[] = [
    undefined,
    { direction: "inbound", state: "verified" } as Call,
    { direction: "inbound", state: "code_sent" } as Call,
    { direction: "outbound", state: "verified" } as Call,
  ];
  const policy = { controlledEarlyWindowDays: 3 };

  it("for every seed prescription and call shape", () => {
    for (const rx of SEED.prescriptions) {
      const patient = SEED.patients.find((p) => p.id === rx.patientId)!;
      for (const call of calls) {
        const ctx = buildContext({ now: "2026-11-24T10:00:00-05:00", patient, rx, call, reason: "", record: [], policy });
        for (const card of STARTING_CARDS.filter((c) => c.live)) {
          for (const field of card.when.flatMap(fieldsOf)) {
            expect(ctx[field as keyof RuleContext], `card ${card.id} reads ${field} (${rx.id})`).not.toBeUndefined();
          }
        }
      }
    }
  });
});

describe("a missing field makes a refuse or route card fire", () => {
  const card = (then: RuleCard["then"], when: CardCondition[]): RuleCard => ({
    id: `t_${then}`,
    wording: "test card",
    when,
    then,
    appliesTo: ["request_refill"],
    risk: "test",
    author: "test",
    approvedBy: "test",
    approvedAt: "2026-11-21T00:00:00Z",
    tests: [],
    live: true,
  });
  const missing: CardCondition = { field: "rx.days_late", op: ">", value: 0 };
  const ctx: RuleContext = { "drug.controlled": true };

  it("a refuse card refuses", () => {
    expect(evaluate([card("refuse", [missing])], "request_refill", ctx)).toMatchObject({ outcome: "refuse", deciding: ["t_refuse"] });
  });

  it("a route card routes", () => {
    expect(evaluate([card("route", [missing])], "request_refill", ctx)).toMatchObject({ outcome: "route" });
  });

  it("a missing field in a value reference counts as missing too", () => {
    const ref: CardCondition = { field: "drug.controlled", op: "=", value: true };
    const minus: CardCondition = { field: "rx.days_since_last_fill", op: "<", value: { field: "rx.prescribed_interval_days", minus: "policy.controlled_early_window_days" } };
    expect(evaluate([card("refuse", [ref, minus])], "request_refill", ctx).outcome).toBe("refuse");
  });

  it("a flag card still skips, since a flag can't stop anything", () => {
    expect(evaluate([card("flag", [missing])], "request_refill", ctx).outcome).toBe("allowed");
  });

  it("the card's other conditions still have to hold", () => {
    const notControlled: CardCondition = { field: "drug.controlled", op: "=", value: false };
    expect(evaluate([card("refuse", [notControlled, missing])], "request_refill", ctx).outcome).toBe("allowed");
  });
});
