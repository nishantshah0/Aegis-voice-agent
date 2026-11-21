import { cn } from "./cn";

/**
 * The Aegis mark: a shield holding a two-tone capsule. It takes its colours from
 * the tokens, so it is green on warm white and bright green on the dark theme.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="var(--rg-accent)" d="M16 1.75 28 6.25v8.6c0 7.3-4.9 13.3-12 15.4C8.9 28.15 4 22.15 4 14.85v-8.6L16 1.75Z" />
      <g transform="rotate(45 16 15.75)" fill="var(--rg-ink-inverse)">
        <path d="M12 15v-4a4 4 0 0 1 8 0v4h-8Z" />
        <path fillOpacity=".55" d="M12 16.5h8v4a4 4 0 0 1-8 0v-4Z" />
      </g>
    </svg>
  );
}

/** Mark plus wordmark. Use `size` to scale both together. */
export function Logo({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: ["size-5", "text-[15px]"], md: ["size-6", "text-[17px]"], lg: ["size-9", "text-2xl"] }[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark className={s[0]} />
      <span className={cn("font-semibold tracking-[-0.02em] text-ink", s[1])}>Aegis</span>
    </span>
  );
}
