// The waiting rule (scripts/channel_waiting.py), with the HUMAN's repro from Sat 11:02:
// a MERGED to ALL must not clear open requests to that role.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const python = ["python3", "python", "py"].find((p) => spawnSync(p, ["-c", "import sys"]).status === 0);

function waiting(role: string, heads: string[]): string {
  const lines = heads.map((b, i) => JSON.stringify({ t: `2026-11-21T10:${String(10 + i).padStart(2, "0")}:00Z`, u: "x", b })).join("\n");
  const r = spawnSync(python!, ["scripts/channel_waiting.py", role], { input: lines, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe.skipIf(!python)("channel.sh waiting", () => {
  it("a MERGED or HANDOFF to ALL doesn't answer open requests (the repro)", () => {
    const out = waiting("4", [
      "[ROLE-1 · REQUEST → ROLE-4] 1.2: ok to add @anthropic-ai/sdk?",
      "[ROLE-3 · REQUEST → ROLE-4] 3.4 batch persistence",
      "[ROLE-1 · REQUEST → ROLE-4] 1.2: no button gives an rx_id",
      "[ROLE-4 · MERGED → ALL] 4.3 fixes on main",
      "[ROLE-4 · HANDOFF → ROLE-1] something else",
    ]);
    const owe = out.split("You are waiting on:")[0];
    expect(owe).toContain("ok to add @anthropic-ai/sdk");
    expect(owe).toContain("3.4 batch persistence");
    expect(owe).toContain("no button gives an rx_id");
  });

  it("a REPLY from the asked role to the asker answers it; a REPLY to someone else doesn't", () => {
    const out = waiting("4", [
      "[ROLE-1 · REQUEST → ROLE-4] first",
      "[ROLE-3 · REQUEST → ROLE-4] second",
      "[ROLE-4 · REPLY → ROLE-1] answer to first",
      "[ROLE-4 · REPLY → ROLE-2] not for ROLE-3",
    ]);
    const owe = out.split("You are waiting on:")[0];
    expect(owe).not.toContain("first");
    expect(owe).toContain("second");
  });

  it("a request to ALL or HUMAN is answered by a REPLY or HUMAN from anyone else to the asker", () => {
    const out = waiting("4", [
      "[ROLE-4 · REQUEST → HUMAN] need an ok",
      "[ROLE-4 · REQUEST → ALL] anyone?",
      "[HUMAN · ROLE-4] ok: go",
    ]);
    const wait = out.split("You are waiting on:")[1];
    expect(wait).not.toContain("need an ok");
    expect(wait).not.toContain("anyone?");
  });

  it("only the asked role's REPLY counts for a request to one role", () => {
    const out = waiting("2", ["[ROLE-2 · REQUEST → ROLE-4] please", "[ROLE-3 · REPLY → ROLE-2] I'm not Role 4"]);
    expect(out.split("You are waiting on:")[1]).toContain("please");
  });

  it("BLOCKED is cleared by a HUMAN to that role", () => {
    const out = waiting("4", ["[ROLE-4 · BLOCKED → HUMAN] stuck", "[HUMAN · ROLE-4] fixed it"]);
    expect(out.split("You are waiting on:")[1]).not.toContain("stuck");
  });
});
