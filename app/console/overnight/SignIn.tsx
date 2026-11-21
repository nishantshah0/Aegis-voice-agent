import { AUTH_ROUTES, auth0Configured } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Badge } from "@/components/ui";

// Who is signed in, from the Auth0 session (the same check as /console/today).
// Plain links: sign-in and sign-out are full-page redirects through Auth0.
export async function SignIn() {
  if (!auth0Configured()) return <span className="text-sm text-stop">Auth0 isn&apos;t configured on this server.</span>;
  const approver = await getApprover();
  if (!approver) {
    return (
      <a href={AUTH_ROUTES.login} className="rounded-full border border-line-strong px-3.5 py-1.5 text-[13px] hover:border-ink-3">
        Sign in
      </a>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm text-ink-2">
      {approver.name} <Badge>{approver.role}</Badge>
      <a href={AUTH_ROUTES.logout} className="underline hover:text-ink">
        Sign out
      </a>
    </span>
  );
}
