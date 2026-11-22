"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo, cn } from "@/components/ui";
import { Icon } from "./Icon";
import { AREAS, OVERVIEW, areaFor, isActivePath, pageFor, type Area, type NavItem } from "./nav";

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
        active ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken/60 hover:text-ink",
      )}
    >
      <Icon name={item.icon} className={cn("size-4", active ? "text-accent" : "text-ink-3")} />
      {item.label}
    </Link>
  );
}

/** The area's square tile: green for Pharmacy, blue for Safety (each in its own accent). */
function AreaTile({ area, className }: { area: Area; className?: string }) {
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent", area.key === "safety" ? "theme-safety" : "theme-pharmacy", className)}>
      <Icon name={area.key === "safety" ? "badge" : "calls"} className="size-4" />
    </span>
  );
}

/** Switches between the two product areas. A menu, so the sidebar lists one area at a time. */
function AreaSwitcher({ current }: { current: Area }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const at = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border bg-surface px-2 py-1.5 text-left transition-colors hover:border-line-strong",
          open ? "border-line-strong" : "border-line",
        )}
      >
        <AreaTile area={current} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{current.label}</span>
          <span className="block truncate text-[11px] text-ink-3">Switch area</span>
        </span>
        <Icon name="chevrons" className="size-4 text-ink-3" />
      </button>
      {open && (
        // Opens beside the sidebar on a desktop (so it never sits over the page list), below the button on a phone.
        <div
          role="menu"
          aria-label="Product area"
          className="absolute inset-x-0 top-full z-50 mt-1.5 rounded-xl border border-line-strong bg-raised p-1.5 shadow-pop lg:inset-x-auto lg:left-full lg:top-0 lg:ml-3 lg:mt-0 lg:w-80"
        >
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Switch area</p>
          {AREAS.map((a) => (
            <Link
              key={a.key}
              role="menuitem"
              href={a.home}
              onClick={() => setOpen(false)}
              aria-current={a.key === current.key ? "true" : undefined}
              className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken"
            >
              <AreaTile area={a} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{a.label}</span>
                <span className="block text-xs text-ink-3">{a.hint}</span>
              </span>
              {a.key === current.key && <Icon name="check" className="size-4 text-accent" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The signed-in app: one dark theme. The sidebar has the area switcher at the top, the
 * overview and the current area's pages under it, and the account at the bottom. The top
 * bar says where you are and holds the Demo controls menu. On a phone the sidebar becomes
 * a header with the pages wrapped onto as many rows as they need (nothing hides off-screen).
 */
export function AppFrame({ account, demo, children }: { account: ReactNode; demo?: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const inArea = areaFor(pathname);
  const area = inArea ?? AREAS[0];
  const page = pageFor(pathname);
  const isActive = (href: string) => isActivePath(pathname, href);

  return (
    <div className={cn("theme-dark theme-app min-h-screen bg-canvas text-ink lg:flex", inArea?.key === "safety" && "theme-safety")}>
      <aside className="relative z-40 border-b border-line bg-canvas lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center px-4">
          <Link href="/app" aria-label="Aegis overview" className="rounded-md">
            <Logo />
          </Link>
        </div>

        <div className="px-3 pb-1">
          <AreaSwitcher current={area} />
        </div>

        <nav aria-label={area.label} className="px-3 pb-3 pt-3 lg:flex-1 lg:overflow-y-auto">
          <ul className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
            <li>
              <NavLink item={OVERVIEW} active={isActive(OVERVIEW.href)} />
            </li>
            <li aria-hidden className="mx-1 hidden h-px bg-line lg:my-2 lg:block" />
            {area.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(item.href)} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden border-t border-line p-3 lg:block">{account}</div>
      </aside>

      <div className="min-w-0 flex-1 lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-line bg-canvas/85 px-5 backdrop-blur md:px-8">
          <p className="flex min-w-0 items-center gap-2 text-[13px]">
            {inArea && (
              <>
                <Link href={inArea.home} className="truncate text-ink-3 transition-colors hover:text-ink">
                  {inArea.short}
                </Link>
                <span aria-hidden className="text-ink-3/60">
                  /
                </span>
              </>
            )}
            <span className="truncate font-medium text-ink">{page?.label ?? "Home"}</span>
          </p>
          <div className="flex items-center gap-2">{demo}</div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
