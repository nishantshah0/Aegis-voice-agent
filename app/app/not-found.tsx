import Link from "next/link";
import { ButtonLink, linkClass } from "@/components/ui";

// Inside the app shell: an /app page that doesn't exist, or a record that isn't there.
export default function AppNotFound() {
  return (
    <div className="max-w-lg py-8">
      <p className="font-mono text-xs text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-ink">Nothing here</h1>
      <p className="mt-2 text-sm leading-6 text-ink-2">This page or record doesn&apos;t exist. It may have been cleared by a demo reset.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <ButtonLink href="/app" size="sm">
          Go to Home
        </ButtonLink>
        <Link href="/app/pharmacy/calls" className={linkClass + " text-[13px]"}>
          All calls
        </Link>
      </div>
    </div>
  );
}
