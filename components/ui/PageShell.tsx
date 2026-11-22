import type { ReactNode } from "react";
import { cn } from "./cn";
import { SiteHeader, type NavLink } from "./Nav";

/**
 * Every product page: header, a centred content column, and the canvas colour.
 * `theme="dark"` switches the tokens for the stage and the phone.
 */
export function PageShell({
  children,
  current,
  links,
  right,
  theme = "light",
  width = "default",
  className,
}: {
  children: ReactNode;
  current?: string;
  links?: NavLink[];
  right?: ReactNode;
  theme?: "light" | "dark";
  width?: "narrow" | "default" | "wide";
  className?: string;
}) {
  const max = { narrow: "max-w-3xl", default: "max-w-6xl", wide: "max-w-[96rem]" }[width];
  return (
    <div className={cn("flex min-h-screen flex-col bg-canvas text-ink", theme === "dark" && "theme-dark")}>
      <SiteHeader current={current} links={links} right={right} />
      <main className={cn("mx-auto w-full flex-1 px-5 py-8 md:px-8 md:py-10", max, className)}>{children}</main>
    </div>
  );
}

/**
 * Every page's header: title, a one-line description, and the page's actions on the right
 * (the primary one last). The content below starts 32 px under it (mt-8).
 */
export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[34px] leading-tight text-ink md:text-[44px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A section's title row inside a page: title, optional one-liner, and a link or action. */
export function SectionHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1", className)}>
      <div className="min-w-0">
        <h2 className="text-[22px] leading-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 text-[13px]">{action}</div>}
    </div>
  );
}
