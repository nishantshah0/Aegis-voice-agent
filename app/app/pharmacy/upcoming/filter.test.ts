import { describe, expect, it } from "vitest";
import type { UpcomingRow } from "@/app/console/upcoming/upcoming";
import { filterUpcoming, matches, nextUp } from "./filter";

const row = (over: Partial<UpcomingRow>): UpcomingRow => ({
  patientId: "p1",
  rxId: "rx1",
  initials: "S.R.",
  drug: "Concerta 36 mg",
  controlled: true,
  daysLeft: 2,
  runOut: "2026-11-26",
  preview: { kind: "lane", lane: "review", ruleIds: ["4"], signals: [] },
  nextReminder: "today",
  ...over,
});

describe("upcoming filters", () => {
  const rows = [
    row({}),
    row({ rxId: "rx2", initials: "A.B.", drug: "Metformin 500 mg", daysLeft: -1, runOut: "2026-11-23", preview: { kind: "refused", ruleIds: ["7"] }, nextReminder: "won't ring: rule 7" }),
    row({ rxId: "rx3", daysLeft: 9, runOut: "2026-12-03", nextReminder: "2026-11-26" }),
  ];

  it("matches each filter", () => {
    expect(rows.filter((r) => matches(r, "soon")).map((r) => r.rxId)).toEqual(["rx1"]);
    expect(rows.filter((r) => matches(r, "late")).map((r) => r.rxId)).toEqual(["rx2"]);
    expect(rows.filter((r) => matches(r, "review")).map((r) => r.rxId)).toEqual(["rx1", "rx3"]);
    expect(rows.filter((r) => matches(r, "wont_ring")).map((r) => r.rxId)).toEqual(["rx2"]);
  });

  it("searches initials and medicine, and narrows to a day", () => {
    expect(filterUpcoming(rows, { filter: "all", query: "metformin" }).map((r) => r.rxId)).toEqual(["rx2"]);
    expect(filterUpcoming(rows, { filter: "all", query: "", day: "2026-12-03" }).map((r) => r.rxId)).toEqual(["rx3"]);
  });

  it("lists who the daily check rings next", () => {
    expect(nextUp(rows).map((r) => r.rxId)).toEqual(["rx1"]);
  });
});
