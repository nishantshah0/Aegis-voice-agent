import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/** A data table in a card: hairline rows, small grey headers, tabular numbers. */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table className={cn("w-full text-sm tabular-nums", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line text-left text-xs text-ink-3", className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-3 font-medium whitespace-nowrap", className)} {...rest} />;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line align-middle last:border-0 hover:bg-sunken/60", className)} {...rest} />;
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 text-ink-2", className)} {...rest} />;
}

/** Shown in place of rows when there are none. */
export function TableEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">{children}</p>;
}
