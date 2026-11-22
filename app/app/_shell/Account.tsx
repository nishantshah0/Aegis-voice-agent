import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Icon } from "./Icon";

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Who is signed in. Sign-out is a full-page redirect through Auth0.
export async function Account() {
  await connection(); // A request-time read: never prerendered (the session check uses the clock).
  const approver = await getApprover();
  if (!approver) return null;
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
        {initials(approver.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{approver.name}</span>
        <span className="block text-[11px] capitalize text-ink-3">{approver.role}</span>
      </span>
      {process.env.AEGIS_PUBLIC_ORIGIN ? (
        <form method="post" action="/api/presenter/logout">
          <button type="submit" title="Sign out" aria-label="Sign out" className="rounded-md p-1.5 text-ink-3 hover:bg-sunken">
            <Icon name="signout" className="size-4" />
          </button>
        </form>
      ) : <a href={AUTH_ROUTES.logout} title="Sign out" aria-label="Sign out" className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink">
        <Icon name="signout" className="size-4" />
      </a>}
    </div>
  );
}
