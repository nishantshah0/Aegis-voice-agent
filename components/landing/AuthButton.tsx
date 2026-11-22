import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";

export const SIGN_IN_HREF = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent("/dashboard")}`;

/** "Sign in" before Auth0 knows you, "Open dashboard" after. Static fallback: Sign in. */
export function SignInLink({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <a href={SIGN_IN_HREF} className={buttonClass("primary", size)}>
      Sign in
    </a>
  );
}

export async function AuthButton({ size = "sm" }: { size?: "sm" | "lg" }) {
  const approver = await getApprover();
  if (!approver) return <SignInLink size={size} />;
  return (
    <Link href="/dashboard" className={buttonClass("primary", size)}>
      Open dashboard
    </Link>
  );
}
