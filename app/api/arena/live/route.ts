import { after } from "next/server";
import { CALLS_PER_HOUR } from "@/lib/agent";
import { refuseUnlessPharmacist, refuseUnlessStaff } from "../../_lib/arena-runs";
import { fail, ok, readObject } from "../../_lib/http";
import {
  CALLS_PER_EXCHANGE,
  claimLiveCall,
  hasRoom,
  listLiveCalls,
  liveCallRunning,
  parseAttack,
  resolveSource,
  runLiveCall,
  saveCustomAttack,
  summarize,
  usedThisHour,
} from "../../_lib/live-calls";

// POST /api/arena/live { source: { kind: card|scenario|custom, id } | { kind: "new", attack, save? } }
//   → 202 { id }. Starts a live attack call: an attacker AI rings the real pharmacy agent on a
//   simulated line (Trail #69, Role 2 stand-in). Pharmacist only; one call at a time (409);
//   429 when the hourly cap has no room; 503 unless LIVE_AGENT=1.
export async function POST(request: Request) {
  const refused = await refuseUnlessPharmacist();
  if (refused) return refused;
  if (process.env.LIVE_AGENT !== "1") return fail(503, "The live agent is off on this server. Set LIVE_AGENT=1 to run on this machine's Claude plan.");
  const body = await readObject(request);
  const source = (body?.source ?? null) as Record<string, unknown> | null;

  let resolved;
  if (source?.kind === "new") {
    const attack = parseAttack(source.attack ?? body?.attack);
    if (typeof attack === "string") return fail(400, attack);
    const id = (source.save ?? body?.save) === true ? await saveCustomAttack(attack) : null;
    resolved = { attack, source: id ? ({ kind: "custom", id } as const) : ({ kind: "new" } as const) };
  } else {
    resolved = await resolveSource(source);
    if (typeof resolved === "string") return fail(400, resolved);
  }

  if (liveCallRunning()) return fail(409, "A live call is already going. One at a time.");
  if (!(await hasRoom())) {
    const res = fail(429, `The live cap is full: ${await usedThisHour()} of ${CALLS_PER_HOUR} model calls used in the last hour (a turn needs up to ${CALLS_PER_EXCHANGE}). Try again later.`);
    res.headers.set("retry-after", "600");
    return res;
  }
  const call = claimLiveCall(resolved.attack, resolved.source);
  after(() => runLiveCall(call));
  return ok({ id: call.id }, 202);
}

// GET /api/arena/live → { running, recent, usage }
export async function GET() {
  const refused = await refuseUnlessStaff();
  if (refused) return refused;
  const running = liveCallRunning();
  return ok({ running: running ? summarize(running) : null, recent: await listLiveCalls(10), usage: { used: await usedThisHour(), perHour: CALLS_PER_HOUR } });
}
