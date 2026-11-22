import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * A data table in a card: 40 px rows, hairline dividers, small grey headers, tabular
 * numbers. Clickable rows get hover, a selected state (`aria-selected`) and keyboard focus;
 * wrap the table in <RowNav> for ↑/↓ and J/K between them.
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table className={cn("w-full text-[13px] tabular-nums", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line bg-sunken/40 text-left text-xs text-ink-3", className)} {...rest} />;
}

type Align = { numeric?: boolean };

export function Th({ className, numeric, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & Align) {
  return <th className={cn("h-9 px-4 font-medium whitespace-nowrap", numeric && "text-right", className)} {...rest} />;
}

export function Tr({ className, onClick, tabIndex, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  const interactive = Boolean(onClick) || tabIndex !== undefined;
  return (
    <tr
      onClick={onClick}
      tabIndex={tabIndex}
      data-row={interactive ? "" : undefined}
      className={cn(
        "border-b border-line align-middle transition-colors last:border-0 hover:bg-sunken/50",
        interactive && "cursor-pointer focus-visible:bg-sunken focus-visible:shadow-[inset_2px_0_0_var(--rg-accent)] focus-visible:outline-none aria-selected:bg-accent-soft/60",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, numeric, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & Align) {
  return <td className={cn("px-4 py-2.5 text-ink-2", numeric && "text-right tabular-nums", className)} {...rest} />;
}

/** Shown in place of rows when there are none: one line, and the next step if there is one. */
export function TableEmpty({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-ink-3", className)}>
      <p className="flex items-center gap-2.5">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-3/60" />
        {children}
      </p>
      {action}
    </div>
  );
}

/** The same compact empty state, by its general name. */
export const EmptyState = TableEmpty;
