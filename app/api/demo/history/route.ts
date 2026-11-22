import { emit } from "@/lib/events";
import { demoControlsRefused } from "../../_lib/demo";
import { historySummary, seedDemoHistory } from "../../_lib/demo-history";
import { ok } from "../../_lib/http";
import { getStore } from "../../_lib/runtime";

// POST /api/demo/history → { seeded, calls, lanes, caught, decided }
// "Seed a week of calls": about 40 scripted calls over the 7 days before the demo clock,
// each through the real agent driver, control layer, speech guard and record (only the
// model is scripted: no model calls, no usage cap). Marked "scripted demo history" in the
// record. Idempotent (seeded: false when it's already there); Reset demo clears it. Sam
// Rivera is never in it, so reset → seed → pair → daily check still rings him last.
// GET /api/demo/history → the same summary, without running anything.
// Both need the demo controls (a signed-in pharmacist or reviewer, or DEMO_CONTROLS=on).

export async function POST() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const summary = await seedDemoHistory(getStore());
  // Pages listening for the clock re-read their data; the history moved nothing live.
  emit({ type: "clock", now: await getStore().now() });
  return ok(summary);
}

export async function GET() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  return ok(await historySummary(getStore()));
}
