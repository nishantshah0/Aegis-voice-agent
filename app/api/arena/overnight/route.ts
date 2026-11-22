import { after } from "next/server";
import { arenaStatus, claimArenaRun, parseNightBody, refuseArenaStart, refuseUnlessStaff, runOvernightNow } from "../../_lib/arena-runs";
import { fail, ok, readObject } from "../../_lib/http";

// POST /api/arena/overnight { calls?: 1..60, model?: "claude-haiku-5-5" | "gemini-2.5-flash" } → 202 { started: true, run }
// Runs Role 3's overnight attacker on the live agent for `calls` attack calls (default 10;
// Role 2 stand-in, Trail #68). Same rules as /api/arena/run: pharmacist only, one run at a
// time, under the hourly cap. Results go to results/arena/overnight/<run>/report.json.
export async function POST(request: Request) {
  const refused = await refuseArenaStart();
  if (refused) return refused;
  const parsed = parseNightBody(request.headers.get("content-type")?.includes("json") ? await readObject(request) : null);
  if (typeof parsed === "string") return fail(400, parsed);
  const run = claimArenaRun("overnight", parsed.calls, parsed.model);
  after(() => runOvernightNow(run, parsed.calls, parsed.model));
  return ok({ started: true, run }, 202);
}

// GET /api/arena/overnight → the same progress as GET /api/arena/run.
export async function GET() {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  return ok(await arenaStatus());
}
