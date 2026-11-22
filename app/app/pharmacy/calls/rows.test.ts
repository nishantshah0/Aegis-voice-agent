import { describe, expect, it } from "vitest";
import type { QueueItem } from "@/lib/contract";
import type { CallSummary } from "@/app/console/calls/calls";
import { filterRows, outcomeOf, toRow, type HistoryRow } from "./rows";

const item = (over: Partial<QueueItem>): QueueItem => ({
  id: "q1",
  callId: "c_0001",
  patientId: "p_sam",
  kind: "refill",
  lane: "review",
  ruleIds: ["4"],
  signals: [],
  notes: [],
  status: "open",
  createdAt: "2026-11-24T15:00:00.000Z",
  ...over,
});

const call = (over: Partial<CallSummary> = {}): CallSummary => ({
  callId: "c_0001",
  direction: "outbound",
  state: "ended",
  startedAt: "2026-11-24T15:00:00.000Z",
  patient: "S.R.",
  transcript: [
    { who: "agent", text: "Hi, this is Maple Street Pharmacy." },
    { who: "caller", text: "I've been sleeping badly." },
  ],
  presses: [{ button: "request_refill", outcome: "routed", ruleIds: ["4"], lane: "review" }],
  blocked: [],
  record: { entries: 5 },
  ...over,
});

describe("outcomeOf", () => {
  it("puts waiting first, then declined, approved, automatic, refused, nothing", () => {
    expect(outcomeOf([], [item({ status: "open" }), item({ status: "denied" })])).toBe("waiting");
    expect(outcomeOf([], [item({ status: "approved" }), item({ status: "denied" })])).toBe("denied");
    expect(outcomeOf([], [item({ status: "approved" })])).toBe("approved");
    expect(outcomeOf([], [item({ lane: "automatic" })])).toBe("automatic");
    expect(outcomeOf([{ outcome: "refused" }], [])).toBe("refused");
    expect(outcomeOf([{ outcome: "allowed" }], [])).toBe("nothing");
  });
});

describe("filterRows", () => {
  const rows: HistoryRow[] = [
    toRow(call(), [item({})]),
    toRow(call({ callId: "c_0002", patient: "A.B.", transcript: [{ who: "caller", text: "What does it cost?" }], presses: [] }), []),
  ];

  it("counts presses and keeps a short preview", () => {
    expect(rows[0]).toMatchObject({ lanes: ["review"], outcome: "waiting", presses: { routed: 1, allowed: 0 }, lines: 2 });
    expect(rows[0].preview).toHaveLength(2);
  });

  it("filters by lane, outcome and words said", () => {
    expect(filterRows(rows, { query: "", lane: "review", outcome: "all" }).map((r) => r.callId)).toEqual(["c_0001"]);
    expect(filterRows(rows, { query: "", lane: "none", outcome: "all" }).map((r) => r.callId)).toEqual(["c_0002"]);
    expect(filterRows(rows, { query: "", lane: "all", outcome: "nothing" }).map((r) => r.callId)).toEqual(["c_0002"]);
    expect(filterRows(rows, { query: "SLEEPING", lane: "all", outcome: "all" }).map((r) => r.callId)).toEqual(["c_0001"]);
    expect(filterRows(rows, { query: "a.b.", lane: "all", outcome: "all" }).map((r) => r.callId)).toEqual(["c_0002"]);
  });
});
