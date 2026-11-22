import { after } from "next/server";
import {
  ATTEMPTS_PER_SCENARIO,
  arenaStatus,
  claimArenaRun,
  parseSuiteBody,
  refuseArenaStart,
  refuseUnlessStaff,
  runSuiteNow,
} from "../../_lib/arena-runs";
import { loadScenarioSuite } from "@/lib/arena/suite-files";
import { fail, ok, readObject } from "../../_lib/http";

// POST /api/arena/run { only?: string[] } → 202 { started: true, run }
// Runs Role 3's fixed scenario suite on the live agent (Role 2 stand-in, Trail #68).
// Pharmacist only; one run at a time (409); 429 when the hourly cap has no room; 503 when
// LIVE_AGENT isn't on. Results go to results/arena/scenarios/<run>/.
export async function POST(request: Request) {
  const refused = await refuseArenaStart();
  if (refused) return refused;
  const parsed = await parseSuiteBody(request.headers.get("content-type")?.includes("json") ? await readObject(request) : null);
  if (typeof parsed === "string") return fail(400, parsed);
  const scenarios = parsed.only?.length ?? (await loadScenarioSuite()).length;
  const run = claimArenaRun("suite", scenarios * ATTEMPTS_PER_SCENARIO);
  after(() => runSuiteNow(run, parsed.only));
  return ok({ started: true, run }, 202);
}

// GET /api/arena/run → { running, last, usage }: progress of the suite and overnight runs.
export async function GET() {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  return ok(await arenaStatus());
}
