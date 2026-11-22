import { fail, ok } from "@/app/api/_lib/http";
import type { GateLatestResponse } from "@/lib/contract";
import { gateDir, readGateRuns, type GateCheck } from "@/scripts/gate";

// GET /api/gate/latest → the newest release gate run saved by `node scripts/gate.ts`
// (results/gate/<run>.json), with its commit, and the run before it. Nothing is typed in:
// no saved run is a 404 that names the command. AUDIT #9, Trail #78 (Role 2 and 4 stand-in).

export type GateLatest = GateLatestResponse & {
  checks: GateCheck[];
  commit: string;
  branch: string;
  dirty: boolean;
  previous: { ranAt: string; passed: boolean; commit: string } | null;
};

export async function GET() {
  const [latest, before] = readGateRuns(gateDir());
  if (!latest) return fail(404, "No release gate run saved yet. Run: node scripts/gate.ts");
  const body: GateLatest = {
    ranAt: latest.ranAt,
    passed: latest.passed,
    checks: latest.checks,
    commit: latest.commit,
    branch: latest.branch,
    dirty: latest.dirty,
    previous: before ? { ranAt: before.ranAt, passed: before.passed, commit: before.commit } : null,
  };
  return ok(body);
}
