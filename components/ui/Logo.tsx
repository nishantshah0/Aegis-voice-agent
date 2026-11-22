import { cn } from "./cn";

// The Aegis mark: our shield carrying a sheriff's star (rules in code are the law), with the
// two-tone capsule at its centre.
// It takes its colours from the tokens: green on warm white, bright green on the dark theme.
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="var(--rg-accent)" d="M16 1.75 28 6.25v8.6c0 7.3-4.9 13.3-12 15.4C8.9 28.15 4 22.15 4 14.85v-8.6L16 1.75Z" />
      <g fill="var(--rg-ink-inverse)">
        <path d="M16.00 7.00 L18.35 12.36 L24.18 12.94 L19.80 16.84 L21.05 22.56 L16.00 19.60 L10.95 22.56 L12.20 16.84 L7.82 12.94 L13.65 12.36Z" />
        <circle cx="16.0" cy="6.8" r="1.5" /><circle cx="24.37" cy="12.88" r="1.5" /><circle cx="21.17" cy="22.72" r="1.5" /><circle cx="10.83" cy="22.72" r="1.5" /><circle cx="7.63" cy="12.88" r="1.5" />
      </g>
      <g transform="rotate(45 16 15.9)" fill="var(--rg-accent)">
        <path d="M15.1 15.7v-1.5a.9.9 0 0 1 1.8 0v1.5h-1.8Z" />
        <path fillOpacity=".55" d="M15.1 16.1h1.8v1.5a.9.9 0 0 1-1.8 0v-1.5Z" />
      </g>
    </svg>
  );
}

/** "Aegis" set in the site's headline serif (Instrument Serif), so the name matches every page. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display leading-none text-current", className)} aria-label="Aegis">
      Aegis
    </span>
  );
}

/** Mark plus wordmark. Use size to scale both together. */
export function Logo({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: ["size-5", "text-[20px]"], md: ["size-6", "text-[24px]"], lg: ["size-9", "text-[36px]"] }[size];
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <Mark className={s[0]} />
      <Wordmark className={s[1]} />
    </span>
  );
}
