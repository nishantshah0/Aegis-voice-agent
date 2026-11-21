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

/** Page title row: title, a one-line description, and actions on the right. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-[15px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
