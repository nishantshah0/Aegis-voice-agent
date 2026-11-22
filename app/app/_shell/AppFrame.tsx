"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo, cn } from "@/components/ui";
import { Icon } from "./Icon";
import { AREAS, OVERVIEW, areaFor, type NavItem } from "./nav";

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken/70 hover:text-ink",
      )}
    >
      <Icon name={item.icon} className={cn("size-[18px]", active ? "text-accent" : "text-ink-3")} />
      {item.label}
    </Link>
  );
}

/**
 * The signed-in app: a left sidebar with Overview, a switcher between the two product
 * areas, and the current area's pages. The Safety suite switches the whole frame to its
 * own dark look. On a phone the sidebar becomes a top bar.
 */
export function AppFrame({ account, children }: { account: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const area = areaFor(pathname);
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className={cn("min-h-screen bg-canvas text-ink lg:flex", area?.key === "safety" && "theme-dark theme-safety")}>
      <aside className="border-b border-line bg-surface lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 pt-5 lg:pb-2">
          <Link href="/" aria-label="Aegis home" className="rounded-md">
            <Logo />
          </Link>
        </div>

        <div className="px-3 pt-4">
          <NavLink item={OVERVIEW} active={isActive("/app")} />
        </div>

        <div className="px-3 pt-4" role="group" aria-label="Product area">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
            {AREAS.map((a) => (
              <Link
                key={a.key}
                href={a.home}
                aria-current={area?.key === a.key ? "true" : undefined}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-center text-[13px] font-medium transition-colors",
                  area?.key === a.key ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
                )}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Icon name={a.key === "safety" ? "badge" : "calls"} className="size-4" />
                  {a.short}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <nav aria-label={area?.label ?? "Areas"} className="px-3 pb-3 pt-4 lg:flex-1 lg:overflow-y-auto">
          {(area ? [area] : AREAS).map((a) => (
            <div key={a.key} className="mb-4 last:mb-0">
              <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{a.label}</p>
              <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
                {a.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hidden border-t border-line px-3 py-3 lg:block">
          <a
            href="/phone"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-sunken/70 hover:text-ink"
          >
            <Icon name="phone" className="size-[18px] text-ink-3" />
            Patient phone
            <span aria-hidden className="ml-auto text-ink-3">↗</span>
          </a>
          <div className="mt-2 px-2.5">{account}</div>
        </div>
      </aside>

      <div className="flex-1 lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}
