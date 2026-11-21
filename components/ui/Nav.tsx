import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Logo } from "./Logo";

export type NavLink = { href: string; label: string };

/** The product's pages, in demo order. */
export const PRODUCT_LINKS: NavLink[] = [
  { href: "/phone", label: "Patient phone" },
  { href: "/console/today", label: "Pharmacist" },
  { href: "/stage", label: "Stage" },
];

/** Top bar: logo home, page links, and an optional slot on the right (sign-in, CTA). */
export function SiteHeader({ links = PRODUCT_LINKS, current, right, className }: { links?: NavLink[]; current?: string; right?: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md", className)}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 md:px-8">
        <Link href="/" aria-label="Aegis home" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                current === l.href ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}
