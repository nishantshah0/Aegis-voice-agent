import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";

export const SIGN_IN_TO_APP = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent("/app")}`;

// Every page in the app needs a signed-in pharmacist or reviewer. Signed out, it goes to
// Auth0 and comes back to the overview. Sits inside a Suspense boundary (it reads the session).
export async function RequireSignIn({ children }: { children: ReactNode }) {
  await connection(); // A request-time read: never prerendered (the session check uses the clock; AUDIT #15f).
  const approver = await getApprover();
  if (!approver) redirect(SIGN_IN_TO_APP);
  return <>{children}</>;
}
