import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Logo, buttonClass } from "@/components/ui";
import { AUTH_ROUTES, getAuth0 } from "@/lib/auth/auth0";
import { approverFromUser } from "@/lib/auth/session";

export const metadata = { title: "No access · Aegis", robots: { index: false } };

// Where the /app proxy sends an account that signed in but has no pharmacist or reviewer
// role (AUDIT #11). It says who is signed in and offers sign-out, so a stranger's Google
// account isn't a dead end. Nothing from the store or results/ is read here.
async function Who() {
  await connection(); // Reads the session: never prerendered.
  const session = await getAuth0()
    ?.getSession()
    .catch(() => null);
  const user = session?.user;
  const label = [user?.email, user?.name].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!user) {
    return (
      <div className="mt-8 flex flex-wrap gap-2">
        <a href={`${AUTH_ROUTES.login}?returnTo=${encodeURIComponent("/app")}`} className={buttonClass("primary", "md")}>
          Sign in
        </a>
        <Link href="/" className={buttonClass("secondary", "md")}>
          Back to the home page
        </Link>
      </div>
    );
  }
  // A role may have been added since this page loaded: offer the app again.
  if (approverFromUser(user)) {
    return (
      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/app" className={buttonClass("primary", "md")}>
          Open Aegis
        </Link>
      </div>
    );
  }
  return (
    <>
      {label && (
        <p className="mt-6 rounded-lg border border-line bg-sunken px-4 py-3 text-sm text-ink-2">
          Signed in as <span className="font-medium text-ink">{label}</span>
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-2">
        <a href={AUTH_ROUTES.logout} className={buttonClass("primary", "md")}>
          Sign out
        </a>
        <Link href="/" className={buttonClass("secondary", "md")}>
          Back to the home page
        </Link>
      </div>
    </>
  );
}

export default function NoAccessPage() {
  return (
    <main className="theme-dark theme-app flex min-h-screen flex-1 items-center justify-center bg-canvas px-5 py-16 text-ink">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="Aegis home" className="inline-block rounded-md">
          <Logo />
        </Link>
        <h1 className="mt-10 text-2xl font-semibold tracking-[-0.025em]">You don&apos;t have access to Aegis yet</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          This account signed in, but it isn&apos;t a pharmacist or a reviewer at this pharmacy, so the app stays closed. Patient details are only shown to those two roles.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Ask whoever runs Aegis at your pharmacy to give this account the pharmacist or reviewer role, then sign in again. Or sign out and use the account that has it.
        </p>
        <Suspense fallback={<div className="mt-8 h-10 w-64 rounded-full bg-sunken" />}>
          <Who />
        </Suspense>
      </div>
    </main>
  );
}
