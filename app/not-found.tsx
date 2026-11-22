import Link from "next/link";
import { Logo, buttonClass } from "@/components/ui";

export const metadata = { title: "Not found · Aegis" };

// Any URL that matches no page.
export default function NotFound() {
  return (
    <main className="theme-dark theme-app flex min-h-screen flex-1 items-center justify-center bg-canvas px-5 py-16 text-ink">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="Aegis home" className="inline-block rounded-md">
          <Logo />
        </Link>
        <p className="mt-10 font-mono text-xs text-ink-3">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Check the address, or start from one of these.</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/app" className={buttonClass("primary", "md")}>
            Open Aegis
          </Link>
          <Link href="/" className={buttonClass("secondary", "md")}>
            Home page
          </Link>
        </div>
      </div>
    </main>
  );
}
