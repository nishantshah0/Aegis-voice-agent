import { describe, expect, it } from "vitest";
import { STARTING_CARDS, type RuleCard, type RuleContext } from "@/lib/contract";
import { evaluate, holds, stricter } from "./engine";
import { chooseLane } from "./lanes";

const base: RuleContext = {
  "drug.controlled": false,
  "rx.pct_days_elapsed": 90,
  "rx.days_late": 0,
  "rx.refills_left": 2,
  "rx.expired": false,
  "rx.days_since_last_fill": 27,
  "rx.prescribed_interval_days": 30,
  "policy.controlled_early_window_days": 3,
  "recent.blocked_count_10min": 0,
  "recent.renewals_7d": 0,
  "patient.opted_in": true,
  "call.local_hour": 10,
  "recent.outbound_calls_3d": 0,
  "request.days_supply": 30,
  "rx.days_supplied": 30,
  "rx.days_until_due": 3,
};
const refill = (over: RuleContext) => evaluate(STARTING_CARDS, "request_refill", { ...base, ...over });

describe("engine", () => {
  it("strictest wins: refuse > route > flag > allowed", () => {
    expect(stricter("route", "refuse")).toBe("refuse");
    expect(stricter("flag", "route")).toBe("route");
    expect(stricter("allowed", "flag")).toBe("flag");
  });

  it("an ordinary refill matches nothing", () => {
    expect(refill({})).toEqual({ outcome: "allowed", matched: [], deciding: [] });
  });

  it.each([
    ["2a expired", { "rx.expired": true }, "refuse", ["2a"]],
    ["2b no refills", { "rx.refills_left": 0 }, "refuse", ["2b"]],
    ["3 under 80%", { "rx.pct_days_elapsed": 50 }, "route", ["3"]],
    ["4 controlled", { "drug.controlled": true }, "route", ["4"]],
    ["4b controlled and early", { "drug.controlled": true, "rx.days_since_last_fill": 26 }, "refuse", ["4b"]],
    ["6 more than 7 days late", { "rx.days_late": 8 }, "flag", ["6"]],
    ["11 attack in progress", { "recent.blocked_count_10min": 5 }, "route", ["11"]],
  ] as const)("card %s", (_name, over, outcome, deciding) => {
    const v = refill(over as RuleContext);
    expect(v.outcome).toBe(outcome);
    expect(v.deciding).toEqual(deciding);
  });

  it("4b lets a controlled refill through exactly 3 days before the interval", () => {
    expect(refill({ "drug.controlled": true, "rx.days_since_last_fill": 27 }).outcome).toBe("route");
    expect(refill({ "drug.controlled": true, "rx.days_since_last_fill": 26 }).outcome).toBe("refuse");
  });

  it("6 does not flag at exactly 7 days late", () => {
    expect(refill({ "rx.days_late": 7 }).outcome).toBe("allowed");
  });

  it("rule 7 cards apply only to the outbound check", () => {
    const out = (over: RuleContext) => evaluate(STARTING_CARDS, "outbound_check", { ...base, ...over });
    expect(out({}).outcome).toBe("allowed");
    expect(out({ "patient.opted_in": false }).deciding).toEqual(["7a"]);
    expect(out({ "call.local_hour": 8 }).deciding).toEqual(["7b"]);
    expect(out({ "call.local_hour": 20 }).deciding).toEqual(["7c"]);
    expect(out({ "call.local_hour": 19 }).outcome).toBe("allowed");
    expect(out({ "recent.outbound_calls_3d": 1 }).deciding).toEqual(["7d"]);
    expect(refill({ "patient.opted_in": false }).outcome).toBe("allowed");
  });

  it("rule 8 routes a second renewal in 7 days and any controlled renewal", () => {
    const renew = (over: RuleContext) => evaluate(STARTING_CARDS, "request_renewal", { ...base, ...over });
    expect(renew({}).outcome).toBe("allowed");
    expect(renew({ "recent.renewals_7d": 1 }).deciding).toEqual(["8a"]);
    expect(renew({ "drug.controlled": true }).deciding).toEqual(["8b"]);
  });

  it("a card with an unknown outcome refuses, so nothing can loosen the rules", () => {
    const sneaky = { ...STARTING_CARDS[0], id: "99", when: [{ field: "rx.refills_left", op: ">=", value: 0 }], then: "allow" } as unknown as RuleCard;
    expect(evaluate([sneaky], "request_refill", base)).toMatchObject({ outcome: "refuse", deciding: ["99"] });
  });

  it("cards that aren't live, or have no conditions, never match", () => {
    const off: RuleCard = { ...STARTING_CARDS.find((c) => c.id === "4")!, live: false };
    const empty: RuleCard = { ...STARTING_CARDS.find((c) => c.id === "4")!, id: "x", when: [] };
    expect(evaluate([off, empty], "request_refill", { ...base, "drug.controlled": true }).outcome).toBe("allowed");
  });

  it("a missing field never matches", () => {
    expect(holds({ field: "drug.class", op: "=", value: "stimulant" }, {})).toBe(false);
  });

  it("supports every operator", () => {
    const ctx: RuleContext = { "drug.class": "Stimulant", "patient.flags": ["vip"], "rx.refills_left": 2 };
    expect(holds({ field: "drug.class", op: "!=", value: "statin" }, ctx)).toBe(true);
    expect(holds({ field: "rx.refills_left", op: "<=", value: 2 }, ctx)).toBe(true);
    expect(holds({ field: "rx.refills_left", op: ">=", value: 3 }, ctx)).toBe(false);
    expect(holds({ field: "drug.class", op: "in", value: ["Stimulant", "opioid"] }, ctx)).toBe(true);
    expect(holds({ field: "patient.flags", op: "contains", value: "vip" }, ctx)).toBe(true);
    expect(holds({ field: "drug.class", op: "contains", value: "stim" }, ctx)).toBe(true);
  });
});

describe("lanes", () => {
  it("automatic when nothing matched and no signals", () => {
    expect(chooseLane(refill({}), [])).toBe("automatic");
  });
  it("quick check when only the controlled-drug card matched", () => {
    expect(chooseLane(refill({ "drug.controlled": true }), [])).toBe("quick_check");
  });
  it("review for anything unusual", () => {
    expect(chooseLane(refill({ "drug.controlled": true }), ["side_effect"])).toBe("review");
    expect(chooseLane(refill({ "rx.pct_days_elapsed": 50 }), [])).toBe("review");
    expect(chooseLane(refill({}), ["failed_code_attempts"])).toBe("review");
  });
});
