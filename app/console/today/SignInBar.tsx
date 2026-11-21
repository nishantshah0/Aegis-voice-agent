import { AUTH_ROUTES, auth0Configured } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui";

// Who is signed in, from the Auth0 session. Plain links: sign-in and sign-out are
// full-page redirects through Auth0, not client navigation.
export async function SignInBar() {
  if (!auth0Configured()) return <p className="text-sm text-stop">Auth0 isn&apos;t configured on this server.</p>;
  const approver = await getApprover();
  if (!approver) {
    return (
      <a href={AUTH_ROUTES.login} className={buttonClass("primary", "sm")}>
        Sign in
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="signed-in">
      <span className="font-medium text-ink">
        {approver.name} <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium capitalize text-accent-ink">{approver.role}</span>
      </span>
      <a href={AUTH_ROUTES.logout} className="text-ink-2 underline-offset-4 hover:text-ink hover:underline">
        Sign out
      </a>
    </div>
  );
}
