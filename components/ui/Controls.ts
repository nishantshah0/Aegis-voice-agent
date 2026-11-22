import { cn } from "./cn";

/** A filter chip (Everything 12 · Review 3 ...). `active` is the chosen one. */
export function chipClass(active: boolean, className?: string) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
    active ? "border-line-strong bg-raised text-ink shadow-[inset_0_0_0_1px_var(--rg-line-strong)]" : "border-transparent text-ink-3 hover:bg-sunken hover:text-ink",
    className,
  );
}

/** Text inputs, searches and selects. */
export function inputClass(className?: string) {
  return cn(
    "h-8 rounded-lg border border-line-strong bg-sunken px-3 text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none",
    className,
  );
}

/** A quiet text link in the accent colour. */
export const linkClass = "font-medium text-accent underline-offset-4 hover:underline";
