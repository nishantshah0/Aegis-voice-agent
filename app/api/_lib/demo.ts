import { getApprover } from "@/lib/auth/session";
import { fail } from "./http";

// Demo controls (reset, clock, daily check) move the clock and reseed the data, so
// they need a signed-in pharmacist or reviewer. A demo laptop can open them to anyone
// by setting DEMO_CONTROLS=on in its .env (finding F3). Off by default.
export async function demoControlsRefused(): Promise<Response | null> {
  if (process.env.DEMO_CONTROLS === "on") return null;
  return (await getApprover()) ? null : fail(401, "Sign in to use the demo controls");
}
