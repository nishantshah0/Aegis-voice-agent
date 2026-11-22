import { Suspense, type ReactNode } from "react";
import { AUTH_ROUTES, auth0Configured } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Card } from "@/components/ui";

const LOGIN = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent("/app/safety")}`;

/** Is a pharmacist or reviewer signed in? Check this before reading saved results. */
export async function signedIn(): Promise<boolean> {
  return (await getApprover()) !== null;
}

/** Every suite page needs a signed-in pharmacist or reviewer. Nobody else sees saved results. */
export async function RequireSignIn({ children }: { children: ReactNode }) {
  if (await signedIn()) return <>{children}</>;
  return <SignInCard />;
}

/** What a signed-out visitor sees instead of a Safety page. */
export function SignInCard() {
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
 * Every Safety page wraps its content in this. The shell's layout check isn't enough on its
 * own: Next renders a page apart from its layout, so the page's data would still stream.
 */
export function SuiteGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">Checking sign-in…</p>}>
      <RequireSignIn>{children}</RequireSignIn>
    </Suspense>
  );
}
