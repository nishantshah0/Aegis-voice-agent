import Link from "next/link";
import { cn } from "@/components/ui";

const TABS = [
  { key: "today", href: "/console/today", label: "Today" },
  { key: "upcoming", href: "/console/upcoming", label: "Upcoming" },
  { key: "calls", href: "/console/calls", label: "Calls" },
] as const;

/** The pharmacy console's tabs. */
export function ConsoleTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Console" className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
            current === t.key ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
