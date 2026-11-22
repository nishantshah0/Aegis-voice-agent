import Link from "next/link";
import { ButtonLink, linkClass } from "@/components/ui";

// An unknown call id (AUDIT #15e): say so inside the shell, and point back to the list.
export default function CallNotFound() {
  return (
    <div className="max-w-lg py-8">
      <p className="font-mono text-xs text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-ink">No call with that id</h1>
      <p className="mt-2 text-sm leading-6 text-ink-2">It isn&apos;t in the record. Call ids start again from c_0001 after a demo reset, so an old link can point at nothing.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <ButtonLink href="/app/pharmacy/calls" size="sm">
          All calls
        </ButtonLink>
        <Link href="/app/pharmacy/today" className={linkClass + " text-[13px]"}>
          Today
        </Link>
      </div>
    </div>
  );
}
