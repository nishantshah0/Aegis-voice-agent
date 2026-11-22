import { demoControlsRefused } from "@/app/api/_lib/demo";
import { fail, ok, readObject } from "@/app/api/_lib/http";
import { DEFAULT_OPTIONS, newRunId, runAndSave } from "@/lib/sim";

// POST /app/pharmacy/outreach/run {outcomeSeed?, earlyReach?} → {runId}
// Re-runs the outreach simulation over the made-up population and saves it under
// results/sim/<run>/. It never presses a button, never starts a call and never touches the
// live store: the sim runs on its own throwaway store. Signed-in staff, or DEMO_CONTROLS=on,
// like the other demo controls. Lives with the page (not app/api) because it only writes
// simulation files.

export async function POST(request: Request) {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const body = (await readObject(request)) ?? {};
  const outcomeSeed = body.outcomeSeed ?? DEFAULT_OPTIONS.outcomeSeed;
  const earlyReach = body.earlyReach ?? DEFAULT_OPTIONS.earlyReach;
  if (typeof outcomeSeed !== "number" || !Number.isInteger(outcomeSeed) || outcomeSeed < 0 || outcomeSeed > 1e9) return fail(400, "outcomeSeed must be a whole number from 0 to 1000000000");
  if (typeof earlyReach !== "boolean") return fail(400, "earlyReach must be true or false");
  const options = { ...DEFAULT_OPTIONS, outcomeSeed, earlyReach };
  const runId = newRunId(options);
  try {
    await runAndSave({ ...options, runId });
  } catch (e) {
    return fail(500, `Couldn't save the run: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ok({ runId, simulated: true });
}
