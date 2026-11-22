import { Suspense, type ReactNode } from "react";
import { AUTH_ROUTES, auth0Configured } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Badge, Card } from "@/components/ui";

const LOGIN = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent("/dashboard/suite")}`;

/** Who is signed in, from the Auth0 session (the same check as the console). */
export async function SignedInAs() {
  if (!auth0Configured()) return <span className="text-sm text-stop">Auth0 isn&apos;t configured on this server.</span>;
  const approver = await getApprover();
  if (!approver) {
    return (
      <a href={LOGIN} className="rounded-full border border-line-strong px-3.5 py-1.5 text-[13px] hover:border-ink-3">
        Sign in
      </a>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm text-ink-2">
      {approver.name} <Badge tone="accent">{approver.role}</Badge>
      <a href={AUTH_ROUTES.logout} className="underline hover:text-ink">
        Sign out
      </a>
    </span>
  );
}

/** Every suite page needs a signed-in pharmacist or reviewer. Nobody else sees saved results. */
export async function RequireSignIn({ children }: { children: ReactNode }) {
  const approver = auth0Configured() ? await getApprover() : null;
  if (approver) return <>{children}</>;
  return (
    <Card className="mx-auto mt-10 max-w-lg text-center">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in to open the Safety suite</h1>
      <p className="mt-2 text-sm text-ink-2">
        The attacks, scenario runs and rule history are for the pharmacy&apos;s staff: a pharmacist or a reviewer.
      </p>
      {auth0Configured() ? (
        <a href={LOGIN} className="mt-5 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-ink-inverse hover:bg-accent-strong">
          Sign in
        </a>
      ) : (
        <p className="mt-4 text-sm text-stop">Auth0 isn&apos;t configured on this server, so nobody can sign in.</p>
      )}
    </Card>
  );
}

/**
 * Wrap each page's content in this, not the layout: Next renders a page apart from its
 * layout, so a check in the layout alone would still send the page's data to anyone.
 */
export function SuiteGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">Checking sign-in…</p>}>
      <RequireSignIn>{children}</RequireSignIn>
    </Suspense>
  );
}
