import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { Card } from "@/components/ui";

/** Every calls page signed out: a prompt only, never patient detail (Trail #10). */
export function SignedOut({ what, children }: { what: string; children?: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-4">
      {children}
      <Card className="text-sm text-ink-2" data-testid="signed-out">
        <a href={AUTH_ROUTES.login} className="font-medium text-accent underline-offset-4 hover:underline">
          Sign in
        </a>{" "}
        as a pharmacist or reviewer to see {what}.
      </Card>
    </div>
  );
}
