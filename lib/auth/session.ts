import { cookies } from 'next/headers';
import { presenterAuthorized, presenterCookie } from './presenter';
import type { Approver } from "@/lib/contract";
import { ROLE_CLAIM, getAuth0 } from "./auth0";

// Who is making this request, from their Auth0 session. This is the only way to
// name an approver: never from a request body.

export type { Approver };
export type Role = Approver["role"];

/** The approver an Auth0 user stands for, or null if they have no known role. */
export function approverFromUser(user: Record<string, unknown> | null | undefined): Approver | null {
  if (!user || typeof user.sub !== "string" || !user.sub) return null;
  const role = user[ROLE_CLAIM];
  if (role !== "pharmacist" && role !== "reviewer") return null;
  const name = [user.name, user.email].find((v): v is string => typeof v === "string" && v.length > 0) ?? user.sub;
  return { id: user.sub, name, role };
}

/** The signed-in approver for the current request (route handler or server component). */
export async function getApprover(): Promise<Approver | null> {
  if (process.env.AEGIS_PUBLIC_ORIGIN && presenterAuthorized((await cookies()).get(presenterCookie)?.value)) {
    return { id: 'synthetic-presenter', name: 'Demo pharmacist', role: 'pharmacist' };
  }
  const auth0 = getAuth0();
  if (!auth0) return null;
  try {
    const session = await auth0.getSession();
    return approverFromUser(session?.user);
  } catch {
    return null; // An unreadable session is nobody.
  }
}

export function hasRole(approver: Approver | null, role: Role): approver is Approver {
  return approver !== null && approver.role === role;
}
