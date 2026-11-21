import { AUTH_ROUTES, auth0Configured } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";

// Who is signed in, from the Auth0 session. Plain links: sign-in and sign-out are
// full-page redirects through Auth0, not client navigation.
export async function SignInBar() {
  if (!auth0Configured()) return <p className="text-sm text-red-600">Auth0 isn&apos;t configured on this server.</p>;
  const approver = await getApprover();
  if (!approver) {
    return (
      <a href={AUTH_ROUTES.login} className="rounded border border-neutral-400 px-3 py-1.5 text-sm hover:opacity-75">
        Sign in
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="signed-in">
      <span>
        {approver.name} <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-800">{approver.role}</span>
      </span>
      <a href={AUTH_ROUTES.logout} className="underline hover:opacity-75">
        Sign out
      </a>
    </div>
  );
}
