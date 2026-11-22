import { after } from "next/server";
import { refuseUnlessStaff } from "../../_lib/arena-runs";
import { ok, readObject } from "../../_lib/http";
import { claimRunAll, planRunAll, refuseRunAll, runAllNow, runAllStatus } from "../../_lib/run-all";

// POST /api/arena/all { attacker?: "claude" | "gemini" } → 202 { started: true, run }
// Runs every attack in the library in turn (Role 2 stand-in, Trail #69): the hijack batch, the
// attack scenarios on the live agent, then each saved custom attack as a live call. Pharmacist
// only; one run at a time (409). Without LIVE_AGENT=1 only the scripted batch runs.
export async function POST(request: Request) {
  const body = request.headers.get("content-type")?.includes("json") ? await readObject(request) : null;
  const refused = await refuseRunAll(body);
  if (refused instanceof Response) return refused;
  const plan = await planRunAll();
  const run = claimRunAll(plan, refused);
  after(() => runAllNow(run, plan));
  return ok({ started: true, run }, 202);
}

// GET /api/arena/all → { running, last }: the run's steps and their progress. Staff only.
export async function GET() {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  return ok(runAllStatus());
}
