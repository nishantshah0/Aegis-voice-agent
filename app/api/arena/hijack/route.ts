import { after } from "next/server";
import { demoControlsRefused } from "../../_lib/demo";
import { fail, ok } from "../../_lib/http";
import { hijackRunning, runHijackNow } from "./run";

// POST /api/arena/hijack → 202 { started: true }
// Starts the hijack batch in the background; the stage follows it through press,
// blocked_line and score events. Staff, or DEMO_CONTROLS=on. 409 while one is running.
export async function POST() {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  if (hijackRunning()) return fail(409, "A hijack batch is already running");
  after(async () => {
    try {
      await runHijackNow();
    } catch (error) {
      console.error("hijack batch failed", error);
    }
  });
  return ok({ started: true }, 202);
}
