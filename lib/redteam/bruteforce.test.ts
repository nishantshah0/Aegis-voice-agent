// Red-team RT-C5 (Trail #86): a slow brute force. Two wrong codes every 16 minutes never hit
// the 3-in-15-minutes lockout; on main 34d697e that gave 180 wrong codes against one patient in
// 24 hours. Six wrong codes in 24 hours lock the patient for 2 hours (the top session's call; a pharmacist can clear it), and each wrong code after that, within the day, locks again at once. A plain
// test, so the slow brute force stays closed.

import { describe, expect, it } from "vitest";
import { CONTROL_PROBES } from "./control-attacks";

describe("red team, fixed: RT-C5 slow brute force", () => {
  it("at most 6 wrong codes are compared against one patient in 24 hours", async () => {
    const p = CONTROL_PROBES.find((x) => x.id === "c.bruteforce.slow");
    const r = await p!.run();
    expect(r.broke, JSON.stringify(r.actual)).toBe(false);
  }, 60_000);
});
