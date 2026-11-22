import Link from "next/link";
import { cn } from "./cn";

export type ConsoleTab = { key: string; href: string; label: string };

/** Every pharmacy console page, in order. Pass `tabs` to show only the pages that exist. */
export const CONSOLE_TABS: ConsoleTab[] = [
  { key: "today", href: "/console/today", label: "Today" },
  { key: "upcoming", href: "/console/upcoming", label: "Upcoming" },
  { key: "calls", href: "/console/calls", label: "Calls" },
  { key: "review", href: "/console/review", label: "Call quality" },
  { key: "rules", href: "/console/rules", label: "Rules" },
  { key: "overnight", href: "/console/overnight", label: "Overnight" },
];

/** The console's second row of navigation, under the site header. Scrolls sideways on a phone. */
export function ConsoleNav({ current, tabs = CONSOLE_TABS, className }: { current: string; tabs?: ConsoleTab[]; className?: string }) {
  return (
    <nav aria-label="Console" className={cn("-mx-5 overflow-x-auto border-b border-line px-5 md:mx-0 md:px-0", className)}>
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={current === t.key ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
                current === t.key ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
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
