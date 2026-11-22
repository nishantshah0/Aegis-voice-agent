"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export const SUITE_TABS = [
  { href: "/dashboard/suite", label: "Overview" },
  { href: "/dashboard/suite/live", label: "Live gate" },
  { href: "/dashboard/suite/attacks", label: "Attacks" },
  { href: "/dashboard/suite/scenarios", label: "Scenarios" },
  { href: "/dashboard/suite/overnight", label: "Overnight" },
  { href: "/dashboard/suite/rules", label: "Rules" },
] as const;

/** The tab whose page this path belongs to: the overview only on its own path, the rest by prefix. */
export function activeTab(path: string): string {
  const hit = SUITE_TABS.slice(1).find((t) => path === t.href || path.startsWith(`${t.href}/`));
  return hit ? hit.href : SUITE_TABS[0].href;
}

/** The tabs, with `current` marked. Also the fallback while the path streams in. */
export function SuiteNavLinks({ current }: { current: string }) {
  return (
    <nav aria-label="Safety suite" className="-mx-5 mt-3 overflow-x-auto px-5 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {SUITE_TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={current === t.href ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm transition-colors",
                current === t.href ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The tabs, marked from the current path. Render inside <Suspense> (the path is runtime data). */
export function SuiteNav() {
  return <SuiteNavLinks current={activeTab(usePathname() ?? "")} />;
}
