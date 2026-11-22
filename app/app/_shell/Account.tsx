import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";

// Who is signed in. Sign-out is a full-page redirect through Auth0.
export async function Account() {
  await connection(); // A request-time read: never prerendered (the session check uses the clock).
  const approver = await getApprover();
  if (!approver) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{approver.name}</span>
        <span className="text-xs capitalize text-ink-3">{approver.role}</span>
      </span>
      <a href={AUTH_ROUTES.logout} className="shrink-0 text-xs text-ink-2 hover:text-ink">
        Sign out
      </a>
    </div>
  );
}
